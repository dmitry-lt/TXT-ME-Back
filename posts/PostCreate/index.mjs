import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Проверка JWT
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

    // Парсим body
    const body = JSON.parse(event.body);
    const { title, content, tags, postAvatarId, visibilityLevel, commentLevel } = body;

    // Валидация visibilityLevel и commentLevel
    const roleMaxVisibility = {
      'KOMMENTATOR': 10,
      'AVTOR': 20,
      'SMOTRITEL': 30,
      'NASTOIATEL': 40
    };

    const maxAllowed = roleMaxVisibility[userRole] || 0;
    const requestedVisibility = visibilityLevel !== undefined ? Number(visibilityLevel) : 0;
    const requestedCommentLevel = commentLevel !== undefined ? Number(commentLevel) : 0;

    if (requestedVisibility > maxAllowed) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: `Forbidden: Your role allows max visibility level ${maxAllowed}` }),
      };
    }

    if (![0, 10, 20, 30, 40].includes(requestedVisibility)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid visibility level. Must be 0, 10, 20, 30, or 40' }),
      };
    }

    if (requestedCommentLevel > maxAllowed) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: `Forbidden: Your role allows max comment level ${maxAllowed}` }),
      };
    }

    if (![0, 10, 20, 30, 40].includes(requestedCommentLevel)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid comment level. Must be 0, 10, 20, 30, or 40' }),
      };
    }

    // Валидация
    if (!title || !content) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Title and content are required' }),
      };
    }

    // Получаем профиль пользователя для activeAvatarId
    let avatarIdToUse = postAvatarId || null;
    
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

    // Создаём пост
    const postId = uuidv4();
    const now = Date.now();

    const post = {
      postId,
      userId,
      username,
      title,
      content,
      tags: tags || [],
      createdAt: now,
      updatedAt: now,
      commentCount: 0,
      feedKey: 'GLOBAL',
      visibilityLevel: requestedVisibility,
      commentLevel: requestedCommentLevel,
    };

    if (avatarIdToUse) {
      post.postAvatarId = avatarIdToUse;
    }

    // Use TransactWrite to ensure consistency between Post and Tag mappings
    const transactItems = [
      {
        Put: {
          TableName: POSTS_TABLE,
          Item: post,
        }
      }
    ];

    // Add tag mappings
    if (post.tags && post.tags.length > 0) {
      for (const tag of post.tags) {
        transactItems.push({
          Put: {
            TableName: TAG_POSTS_TABLE,
            Item: {
              tag,
              createdAt: post.createdAt,
              postId: post.postId,
              visibilityLevel: post.visibilityLevel
            }
          }
        });
      }
    }

    // DynamoDB Transaction limit is 100 items. If post has > 49 tags, this might fail.
    // Assuming tags are reasonably few.
    await dynamodb.send(new TransactWriteCommand({
      TransactItems: transactItems
    }));

    // Ensure tags exist in CMS-Tags (outside of transaction to avoid ConditionalCheckFailed cancellations)
    if (post.tags && post.tags.length > 0) {
      for (const tag of post.tags) {
        try {
          await dynamodb.send(new PutCommand({
            TableName: TAGS_TABLE,
            Item: { tagId: tag, name: tag },
            ConditionExpression: 'attribute_not_exists(tagId)'
          }));
        } catch (tagErr) {
          // If tag already exists, ignore ConditionalCheckFailed
          if (tagErr.name !== 'ConditionalCheckFailedException') {
            console.error(`Failed to ensure tag ${tag} exists:`, tagErr);
          }
        }
      }
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({ 
        message: 'Post created successfully', 
        post,
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
