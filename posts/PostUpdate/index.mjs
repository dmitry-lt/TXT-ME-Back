import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || 'cms-jwt-secret-prod-2025';
const POSTS_TABLE = 'CMS-Posts';
const USERS_TABLE = 'CMS-Users';
const TAG_POSTS_TABLE = 'CMS-TagPosts';
const TAGS_TABLE = 'CMS-Tags';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'PUT,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const token = event.headers.Authorization?.replace('Bearer ', '') || 
                  event.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: No token provided' }),
      };
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub || decoded.userId;

    const postId = event.pathParameters.id;
    const body = JSON.parse(event.body);
    const { title, content, tags, postAvatarId } = body;

    // Проверяем существование поста и права
    const getResult = await dynamodb.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { postId },
    }));

    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Post not found' }),
      };
    }

    if (getResult.Item.userId !== userId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden: You can only edit your own posts' }),
      };
    }

    // Строим UpdateExpression динамически
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    if (title !== undefined) {
      updateExpressions.push('#title = :title');
      expressionAttributeNames['#title'] = 'title';
      expressionAttributeValues[':title'] = title;
    }

    if (content !== undefined) {
      updateExpressions.push('#content = :content');
      expressionAttributeNames['#content'] = 'content';
      expressionAttributeValues[':content'] = content;
    }

    if (tags !== undefined) {
      updateExpressions.push('#tags = :tags');
      expressionAttributeNames['#tags'] = 'tags';
      expressionAttributeValues[':tags'] = tags || [];
    }

    if (postAvatarId !== undefined) {
      if (postAvatarId === null || postAvatarId === '') {
        // Удаляем аватар
        updateExpressions.push('REMOVE postAvatarId');
      } else {
        // Устанавливаем новый аватар
        updateExpressions.push('postAvatarId = :avatarId');
        expressionAttributeValues[':avatarId'] = postAvatarId;
      }
    }

    updateExpressions.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = Date.now();

    const updateExpression = 'SET ' + updateExpressions.filter(e => !e.startsWith('REMOVE')).join(', ') +
                             (updateExpressions.find(e => e.startsWith('REMOVE')) ? ' REMOVE postAvatarId' : '');

    const transactItems = [
      {
        Update: {
          TableName: POSTS_TABLE,
          Key: { postId },
          UpdateExpression: updateExpression,
          ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 ? expressionAttributeNames : undefined,
          ExpressionAttributeValues: expressionAttributeValues,
        }
      }
    ];

    // Handle tag changes
    if (tags !== undefined) {
      const oldTags = getResult.Item.tags || [];
      const newTags = tags || [];
      const createdAt = getResult.Item.createdAt;

      // Tags to remove
      const toRemove = oldTags.filter(t => !newTags.includes(t));
      for (const tag of toRemove) {
        transactItems.push({
          Delete: {
            TableName: TAG_POSTS_TABLE,
            Key: { tag, createdAt }
          }
        });
      }

      // Tags to add
      const toAdd = newTags.filter(t => !oldTags.includes(t));
      for (const tag of toAdd) {
        transactItems.push({
          Put: {
            TableName: TAG_POSTS_TABLE,
            Item: { tag, createdAt, postId }
          }
        });
        transactItems.push({
          Put: {
            TableName: TAGS_TABLE,
            Item: { tagId: tag, name: tag },
            ConditionExpression: 'attribute_not_exists(tagId)'
          }
        });
      }
    }

    await dynamodb.send(new TransactWriteCommand({
      TransactItems: transactItems
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Post updated successfully' }),
    };

  } catch (error) {
    console.error('Error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message }),
    };
  }
};
