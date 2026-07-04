import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || 'cms-jwt-secret-prod-2025';
const COMMENTS_TABLE = 'CMS-Comments';
const POSTS_TABLE = 'CMS-Posts';
const USERS_TABLE = 'CMS-Users';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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
    const username = decoded.username;
    const userRole = decoded.role || 'KOMMENTATOR';

    const postId = event.pathParameters.id;
    const body = JSON.parse(event.body);
    const { content, parentCommentId, commentAvatarId } = body;

    if (!content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Content is required' }),
      };
    }

    // Проверяем пост на существование и commentLevel
    const postResult = await dynamodb.send(new GetCommand({
      TableName: POSTS_TABLE,
      Key: { postId },
    }));

    if (!postResult.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Post not found' }),
      };
    }

    const post = postResult.Item;
    const commentLevel = post.commentLevel || 0;

    // Роли и уровни
    const roleLevels = {
      'KOMMENTATOR': 10,
      'AVTOR': 20,
      'SMOTRITEL': 30,
      'NASTOIATEL': 40
    };

    const userLevel = roleLevels[userRole] || 0;

    // Только автор поста может комментировать, если его уровень ниже commentLevel
    if (userLevel < commentLevel && post.userId !== userId) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: `Forbidden: This post only allows comments from level ${commentLevel} or higher` }),
      };
    }

    // Получаем activeAvatarId пользователя
    let avatarIdToUse = commentAvatarId || null;
    
    if (!avatarIdToUse) {
      try {
        const userResult = await dynamodb.send(new GetCommand({
          TableName: USERS_TABLE,
          Key: { userId },
        }));

        if (userResult.Item && userResult.Item.activeAvatarId) {
          avatarIdToUse = userResult.Item.activeAvatarId;
        }
      } catch (err) {
        console.error('Failed to fetch user avatar:', err);
      }
    }

    // Создаём комментарий
    const commentId = uuidv4();
    const now = Date.now();

    const comment = {
      commentId,
      postId,
      userId,
      username,
      content,
      createdAt: now,
    };

    if (parentCommentId) {
      comment.parentCommentId = parentCommentId;
    }

    if (avatarIdToUse) {
      comment.commentAvatarId = avatarIdToUse;
    }

    await dynamodb.send(new PutCommand({
      TableName: COMMENTS_TABLE,
      Item: comment,
    }));

    // Увеличиваем счётчик комментариев в посте
    try {
      await dynamodb.send(new UpdateCommand({
        TableName: POSTS_TABLE,
        Key: { postId },
        UpdateExpression: 'ADD commentCount :inc',
        ExpressionAttributeValues: {
          ':inc': 1,
        },
      }));
    } catch (err) {
      console.error('Failed to update comment count:', err);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ 
        message: 'Comment created successfully', 
        comment,
      }),
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
