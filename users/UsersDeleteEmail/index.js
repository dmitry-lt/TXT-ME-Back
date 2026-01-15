const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const jwt = require("jsonwebtoken");

const client = new DynamoDBClient({ region: "eu-north-1" });
const dynamodb = DynamoDBDocumentClient.from(client);
const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

exports.handler = async (event) => {
  try {
    const token =
      event.headers?.Authorization?.replace("Bearer ", "") ||
      event.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "No token provided" }),
      };
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    await dynamodb.send(
      new UpdateCommand({
        TableName: "CMS-Users",
        Key: { userId },
        UpdateExpression: "REMOVE email SET updatedAt = :now",
        ExpressionAttributeValues: {
          ":now": new Date().toISOString(),
        },
      }),
    );

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Email removed successfully" }),
    };
  } catch (error) {
    console.error("Error:", error);
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Invalid or expired token" }),
      };
    }
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};
