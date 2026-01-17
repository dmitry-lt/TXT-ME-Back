import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
  
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: ""
      };
    }

    // Проверка авторизации
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Missing or invalid authorization token" })
      };
    }
    
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    
    if (!decoded || !decoded.userId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid or expired token" })
      };
    }
    
    const userId = decoded.userId;
    const postId = event.pathParameters?.id;
    const commentId = event.pathParameters?.commentId;
    
    if (!commentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Comment ID is required" })
      };
    }
    
    // Получить комментарий для проверки
    const getParams = {
      TableName: "CMS-Comments",
      Key: { commentId }
    };
    
    const getResult = await docClient.send(new GetCommand(getParams));
    
    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Comment not found" })
      };
    }
    
    // Проверить что комментарий принадлежит указанному посту
    if (postId && getResult.Item.postId !== postId) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Comment does not belong to this post" })
      };
    }
    
    // Проверить что пользователь - владелец комментария
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Forbidden: You can only delete your own comments" })
      };
    }
    
    // Удалить комментарий
    const deleteParams = {
      TableName: "CMS-Comments",
      Key: { commentId }
    };
    
    await docClient.send(new DeleteCommand(deleteParams));
    
    // Уменьшить счетчик комментариев у поста
    const updatePostParams = {
      TableName: "CMS-Posts",
      Key: { postId: getResult.Item.postId },
      UpdateExpression: "SET commentCount = if_not_exists(commentCount, :zero) - :one",
      ExpressionAttributeValues: {
        ":one": 1,
        ":zero": 0
      }
    };
    
    await docClient.send(new UpdateCommand(updatePostParams));
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: "Comment deleted successfully",
        commentId,
        postId: getResult.Item.postId
      })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};
