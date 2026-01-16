const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) throw new Error('JWT_SECRET missing');

exports.handler = async (event) => {
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };

  try {
    let token = event.headers?.Authorization || event.headers?.authorization;
    if (token?.startsWith('Bearer ')) token = token.substring(7);
    if (!token) return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Missing token' }) };

    const userToken = jwt.verify(token, JWT_SECRET);

    const body = JSON.parse(event.body);
    const { oldPassword, newPassword } = body;
    
    if (!oldPassword || !newPassword) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing passwords' }) };
    }
    
    if (newPassword.length < 8) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'New password must be at least 8 characters' }) };
    }

    const userResult = await docClient.send(new GetCommand({
      TableName: "CMS-Users",
      Key: { userId: userToken.userId }
    }));

    if (!userResult.Item) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ error: 'User not found' }) };
    }

    const passwordHash = userResult.Item.passwordHash;
    const isValidOld = await bcrypt.compare(oldPassword, passwordHash);
    
    if (!isValidOld) {
      return { statusCode: 401, headers: corsHeaders, body: JSON.stringify({ error: 'Incorrect old password' }) };
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await docClient.send(new UpdateCommand({
      TableName: "CMS-Users",
      Key: { userId: userToken.userId },
      UpdateExpression: "SET passwordHash = :hash, updatedAt = :now",
      ExpressionAttributeValues: {
        ":hash": newHash,
        ":now": new Date().toISOString()
      }
    }));

    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ message: 'Password updated successfully' }) };
  } catch (error) {
    console.error('UpdatePassword error:', error);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: error.message }) };
  }
};
