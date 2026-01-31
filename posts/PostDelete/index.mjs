import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, DeleteCommand, QueryCommand, BatchWriteCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import jwt from "jsonwebtoken";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const JWT_SECRET = process.env.JWT_SECRET || "cms-jwt-secret-prod-2025";

const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
  
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
    const decoded = verifyToken(token);
    
    if (!decoded || !decoded.userId) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Invalid or expired token" })
      };
    }
    
    const userId = decoded.userId;
    const postId = event.pathParameters?.id;
    
    if (!postId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Post ID is required" })
      };
    }
    
    const getParams = {
      TableName: "CMS-Posts",
      Key: { postId }
    };
    
    const getResult = await docClient.send(new GetCommand(getParams));
    
    if (!getResult.Item) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Post not found" })
      };
    }
    
    if (getResult.Item.userId !== userId) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Forbidden: You can only delete your own posts" })
      };
    }
    
    const queryParams = {
      TableName: "CMS-Comments",
      IndexName: "postId-index",
      KeyConditionExpression: "postId = :postId",
      ExpressionAttributeValues: {
        ":postId": postId
      }
    };
    
    const commentsResult = await docClient.send(new QueryCommand(queryParams));
    
    if (commentsResult.Items && commentsResult.Items.length > 0) {
      const batchSize = 25;
      for (let i = 0; i < commentsResult.Items.length; i += batchSize) {
        const batch = commentsResult.Items.slice(i, i + batchSize);
        const deleteRequests = batch.map(comment => ({
          DeleteRequest: {
            Key: { commentId: comment.commentId }
          }
        }));
        
        await docClient.send(new BatchWriteCommand({
          RequestItems: {
            "CMS-Comments": deleteRequests
          }
        }));
      }
    }
    
    // Prepare transaction to delete post and tag mappings
    const transactItems = [
      {
        Delete: {
          TableName: "CMS-Posts",
          Key: { postId }
        }
      }
    ];

    // Add tag mapping deletions
    const post = getResult.Item;
    if (post.tags && Array.isArray(post.tags)) {
      for (const tag of post.tags) {
        transactItems.push({
          Delete: {
            TableName: "CMS-TagPosts",
            Key: { 
              tag, 
              createdAt: post.createdAt 
            }
          }
        });
      }
    }

    await docClient.send(new TransactWriteCommand({
      TransactItems: transactItems
    }));
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        message: "Post, associated comments, and tag mappings deleted successfully",
        postId,
        deletedComments: commentsResult.Items?.length || 0
      })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};
