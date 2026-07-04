import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || 'cms-jwt-secret-prod-2025';

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: ""
    };
  }
  console.log("Event:", JSON.stringify(event));
  
  try {
    const postId = event.pathParameters?.id;

    if (!postId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Post ID is required" })
      };
    }

    // Извлекаем роль и userId из JWT
    let userRole = 'ANONYMOUS';
    let currentUserId = null;

    const authHeader = event.headers.Authorization || event.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userRole = decoded.role || 'KOMMENTATOR';
        currentUserId = decoded.sub || decoded.userId;
      } catch (err) {
        console.error("JWT Verification failed:", err.message);
        // Продолжаем как аноним, если токен невалиден
      }
    }
    
    // Получить пост из DynamoDB
    const result = await docClient.send(new GetCommand({
      TableName: "CMS-Posts",
      Key: { postId }
    }));
    
    if (!result.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Post not found" })
      };
    }

    const post = result.Item;
    const postVisibility = post.visibilityLevel !== undefined ? Number(post.visibilityLevel) : 0;

    // Проверка видимости
    if (postVisibility > 0) {
      // Автор всегда может видеть свой пост
      if (currentUserId && post.userId === currentUserId) {
        // Доступ разрешен
      } else {
        const roleMaxVisibility = {
          'ANONYMOUS': 0,
          'KOMMENTATOR': 10,
          'AVTOR': 20,
          'SMOTRITEL': 30,
          'NASTOIATEL': 40
        };

        const maxAllowed = roleMaxVisibility[userRole] || 0;
        if (maxAllowed < postVisibility) {
          return {
            statusCode: 403,
            headers: corsHeaders,
            body: JSON.stringify({ error: "Forbidden: Access denied by visibility level" })
          };
        }
      }
    }
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ post: result.Item })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
