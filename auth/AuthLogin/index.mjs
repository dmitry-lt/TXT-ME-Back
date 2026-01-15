import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

// JWT Secret - use AWS Secrets Manager in production
const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE",
};

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));

  try {
    const body = JSON.parse(event.body || "{}");
    const { username, password } = body;

    // Валидация
    if (!username || !password) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Username and password are required" }),
      };
    }

    // Найти пользователя по username
    const queryParams = {
      TableName: "CMS-Users",
      IndexName: "username-index",
      KeyConditionExpression: "username = :username",
      ExpressionAttributeValues: {
        ":username": username,
      },
    };

    const result = await docClient.send(new QueryCommand(queryParams));

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid credentials" }),
      };
    }

    const user = result.Items[0];

    // Проверить что пользователь активирован (имеет роль)
    if (!user.role) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: "User account not activated. Contact administrator." }),
      };
    }

    // Проверить пароль
    const passwordValid = await bcrypt.compare(password, user.passwordHash);

    if (!passwordValid) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid credentials" }),
      };
    }

    // Создать JWT токен (срок действия 1 час)
    const token = jwt.sign(
      {
        userId: user.userId,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "Login successful",
        token,
        user: {
          userId: user.userId,
          username: user.username,
          role: user.role,
        },
      }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
