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
  };

  try {
    const token =
      event.headers.Authorization?.substring(7) || event.headers.authorization?.substring(7);
    const user = jwt.verify(token, JWT_SECRET);

    const body = JSON.parse(event.body);
    const dataUrl = body.dataUrl;
    if (!dataUrl || !dataUrl.startsWith("data:image") || dataUrl.length > 10000) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid/large image (max 10KB)" }),
      };
    }

    const result = await docClient.send(
      new GetCommand({
        TableName: "CMS-Users",
        Key: { userId: user.userId },
      }),
    );

    const userItem = result.Item;
    let avatars = userItem.avatars || [];
    if (avatars.length >= 50) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Max 50 avatars" }),
      };
    }

    const newAvatar = {
      avatarId: Date.now().toString(),
      dataUrl,
      uploadedAt: Date.now(),
    };
    avatars.push(newAvatar);

    // Only auto-activate if it's the first avatar, no active avatar is set, or active avatar no longer exists
    const activeExists = avatars.some(a => a.avatarId === userItem.activeAvatarId);
    const shouldActivate = avatars.length === 1 || !userItem.activeAvatarId || !activeExists;
    const activeAvatarId = shouldActivate ? newAvatar.avatarId : userItem.activeAvatarId;

    await docClient.send(
      new UpdateCommand({
        TableName: "CMS-Users",
        Key: { userId: user.userId },
        UpdateExpression: "SET avatars = :avatars, activeAvatarId = :active, updatedAt = :now",
        ExpressionAttributeValues: {
          ":avatars": avatars,
          ":active": activeAvatarId,
          ":now": new Date().toISOString(),
        },
      }),
    );

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ avatar: newAvatar, activeAvatarId }),
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
