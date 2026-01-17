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

    const userId = event.pathParameters.userId;
    
    console.log('Fetching avatar for userId:', userId);
    
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
    const activeAvatar = avatars.find(a => a.avatarId === user.activeAvatarId);
    
    console.log('User found:', user.username, 'avatars:', avatars.length);
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        userId: user.userId,
        username: user.username,
        avatars: avatars,
        activeAvatarId: user.activeAvatarId || null,
        avatarDataUrl: activeAvatar?.dataUrl || null
      })
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
