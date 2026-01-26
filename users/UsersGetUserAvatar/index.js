const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: corsHeaders,
        body: ""
      };
    }

    const pathParams = event.pathParameters || {};
    const userId = pathParams.userId;
    const requestedAvatarId = pathParams.avatarId;

    console.log('Fetching avatar for userId:', userId, 'avatarId:', requestedAvatarId);

    // Получаем пользователя по userId
    const result = await dynamodb.send(new GetCommand({
      TableName: 'CMS-Users',
      Key: { userId }
    }));

    if (!result.Item) {
      console.log('User not found:', userId);
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = result.Item;
    const avatars = user.avatars || [];
    const isActiveRequest = requestedAvatarId === 'active';
    const targetAvatarId = isActiveRequest ? user.activeAvatarId : requestedAvatarId;
    const avatar = targetAvatarId ? avatars.find(a => a.avatarId === targetAvatarId) : null;

    console.log('User found:', user.username, 'avatars:', avatars.length);

    if (!avatar) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Avatar not found' })
      };
    }

    // Endpoint 4 (specific avatarId): { userId, username, avatarDataUrl }
    // Endpoint 5 (active): { userId, username, avatarId, avatarDataUrl }
    const response = {
      userId: user.userId,
      username: user.username,
      avatarDataUrl: avatar.dataUrl
    };
    if (isActiveRequest) {
      response.avatarId = avatar.avatarId;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(response)
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
