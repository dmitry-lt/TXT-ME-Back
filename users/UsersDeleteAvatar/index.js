const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const jwt = require("jsonwebtoken");

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);
const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

exports.handler = async (event) => {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "DELETE,OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  try {
    const token =
      event.headers.Authorization?.substring(7) || event.headers.authorization?.substring(7);
    const user = jwt.verify(token, JWT_SECRET);
    const avatarId = event.pathParameters.avatarId;

    const result = await docClient.send(
      new GetCommand({
        TableName: "CMS-Users",
        Key: { userId: user.userId },
      }),
    );

    const userItem = result.Item;
    if (userItem.activeAvatarId === avatarId) {
      return {
        statusCode: 409,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Cannot delete active avatar" }),
      };
    }

    const avatars = (userItem.avatars || []).filter((a) => a.avatarId !== avatarId);
    await docClient.send(
      new UpdateCommand({
        TableName: "CMS-Users",
        Key: { userId: user.userId },
        UpdateExpression: "SET avatars = :avatars, updatedAt = :now",
        ExpressionAttributeValues: { ":avatars": avatars, ":now": new Date().toISOString() },
      }),
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ message: "Avatar deleted", avatarId }),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal error" }),
    };
  }
};
