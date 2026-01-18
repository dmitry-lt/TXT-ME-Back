import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || 'cms-jwt-secret-prod-2025';
const COMMENTS_TABLE = 'CMS-Comments';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'PUT,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const token = event.headers.Authorization?.replace('Bearer ', '') ||
                  event.headers.authorization?.replace('Bearer ', '');

    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.sub || decoded.userId;
    const commentId = event.pathParameters.commentId;
    const { content } = JSON.parse(event.body);

    // 1. Получаем текущий объект
    const getResult = await dynamodb.send(new GetCommand({
      TableName: COMMENTS_TABLE,
      Key: { commentId },
    }));

    if (!getResult.Item) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

    // Проверка прав
    if (getResult.Item.userId !== userId && decoded.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    // 2. Создаем обновленный объект, меняя только контент
    const updatedComment = {
      ...getResult.Item,
      content: content
    };

    // 3. Перезаписываем объект целиком через PutCommand
    await dynamodb.send(new PutCommand({
      TableName: COMMENTS_TABLE,
      Item: updatedComment,
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Updated via Put' }),
    };

  } catch (error) {
    console.error('CRITICAL ERROR:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.name, details: error.message }),
    };
  }
};
