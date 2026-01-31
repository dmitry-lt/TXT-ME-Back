import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-user-id",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
};

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: ""
      };
    }

    const body = JSON.parse(event.body || '{}');
    const { username, password } = body;
    
    // Валидация входных данных
    if (!username || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Username and password are required" })
      };
    }
    
    // Проверить, существует ли пользователь
    const queryParams = {
      TableName: "CMS-Users",
      IndexName: "username-index",
      KeyConditionExpression: "username = :username",
      ExpressionAttributeValues: {
        ":username": username
      }
    };
    
    const existingUser = await docClient.send(new QueryCommand(queryParams));
    
    if (existingUser.Items && existingUser.Items.length > 0) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Username already exists" })
      };
    }
    
    // Хэшировать пароль
    const passwordHash = await bcrypt.hash(password, 10);
    
    // Создать пользователя (без роли - неактивен)
    const userId = randomUUID();
    const newUser = {
      userId,
      username,
      passwordHash,
      createdAt: Date.now()
    };
    
    await docClient.send(new PutCommand({
      TableName: "CMS-Users",
      Item: newUser
    }));
    
    return {
      statusCode: 201,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "User registered successfully. Awaiting activation by admin.",
        userId
      })
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
