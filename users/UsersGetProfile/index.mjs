import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET"
};

const verifyToken = (token) => {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
};

export const handler = async (event) => {
    if (event.httpMethod === "OPTIONS") {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: ""
        };
    }

    console.log("Event:", JSON.stringify(event));
    
    try {
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: "Missing or invalid authorization token" })
            };
        }
        
        const token = authHeader.substring(7);
        const user = verifyToken(token);
        
        if (!user) {
            return {
                statusCode: 401,
                headers: corsHeaders,
                body: JSON.stringify({ error: "Invalid or expired token" })
            };
        }
        
        const result = await docClient.send(new GetCommand({
            TableName: "CMS-Users",
            Key: { userId: user.userId }
        }));
        
        if (!result.Item) {
            return {
                statusCode: 404,
                headers: corsHeaders,
                body: JSON.stringify({ error: "User not found" })
            };
        }
        
        const { passwordHash, ...profile } = result.Item;
        
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(profile)
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
