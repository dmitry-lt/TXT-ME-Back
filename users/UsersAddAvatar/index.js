const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const jwt = require("jsonwebtoken");
const { Jimp } = require("jimp");

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

    // Extract base64 and resize to 50x50
    const base64Match = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid image data format" }),
      };
    }
    const [, formatRaw, base64Data] = base64Match;
    const format = formatRaw.toLowerCase();
    const FORMAT_MIME = {
      jpeg: "image/jpeg",
      jpg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
    };
    const outputMime = FORMAT_MIME[format];
    if (!outputMime) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Unsupported image format (allowed: jpeg, png, gif)" }),
      };
    }
    const buffer = Buffer.from(base64Data, "base64");
    let resizedBuffer;
    try {
      const image = await Jimp.read(buffer);
      // DoS protection: reject oversized images
      if (image.width > 2500 || image.height > 2500) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: "Image too large (max 2500x2500)" }),
        };
      }
      image.cover({ w: 50, h: 50 });
      resizedBuffer = await image.getBuffer(outputMime);
    } catch (err) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid image data" }),
      };
    }
    const resizedDataUrl = `data:${outputMime};base64,${resizedBuffer.toString("base64")}`;

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
      dataUrl: resizedDataUrl,
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
