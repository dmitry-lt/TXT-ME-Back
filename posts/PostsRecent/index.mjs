import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  const corsHeaders = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization"
  };
  
  try {
    const sinceParam = event.queryStringParameters?.since;
    
    if (!sinceParam) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ 
          error: "Missing 'since' parameter",
          example: "?since=2026-01-05T12:00:00Z or ?since=1704456000000"
        })
      };
    }
    
    // Преобразовать в timestamp (миллисекунды)
    let cutoffTimestamp;
    if (sinceParam.includes('T')) {
      // ISO формат - преобразуем в timestamp
      cutoffTimestamp = new Date(sinceParam).getTime();
    } else {
      // Уже timestamp
      cutoffTimestamp = parseInt(sinceParam);
    }
    
    console.log(`Fetching posts and comments since timestamp: ${cutoffTimestamp} (${new Date(cutoffTimestamp).toISOString()})`);
    
    // Получить все посты
    const postsParams = { TableName: "CMS-Posts" };
    const postsResult = await docClient.send(new ScanCommand(postsParams));
    const allPosts = postsResult.Items || [];
    
    // Фильтровать посты по timestamp (createdAt хранится как число)
    const newPosts = allPosts.filter(post => {
      const postTimestamp = typeof post.createdAt === 'number' ? post.createdAt : parseInt(post.createdAt);
      return postTimestamp > cutoffTimestamp;
    });
    
    console.log(`Found ${newPosts.length} new posts out of ${allPosts.length} total`);
    
    // Получить все комментарии
    const commentsParams = { TableName: "CMS-Comments" };
    const commentsResult = await docClient.send(new ScanCommand(commentsParams));
    const allComments = commentsResult.Items || [];
    
    // Фильтровать комментарии по timestamp
    const newComments = allComments.filter(comment => {
      const commentTimestamp = typeof comment.createdAt === 'number' ? comment.createdAt : parseInt(comment.createdAt);
      return commentTimestamp > cutoffTimestamp;
    });
    
    console.log(`Found ${newComments.length} new comments out of ${allComments.length} total`);
    
    // Сортировать по времени (от старых к новым)
    newPosts.sort((a, b) => {
      const aTime = typeof a.createdAt === 'number' ? a.createdAt : parseInt(a.createdAt);
      const bTime = typeof b.createdAt === 'number' ? b.createdAt : parseInt(b.createdAt);
      return aTime - bTime;
    });
    
    newComments.sort((a, b) => {
      const aTime = typeof a.createdAt === 'number' ? a.createdAt : parseInt(a.createdAt);
      const bTime = typeof b.createdAt === 'number' ? b.createdAt : parseInt(b.createdAt);
      return aTime - bTime;
    });
    
    const nowTimestamp = Date.now();
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        success: true,
        since: new Date(cutoffTimestamp).toISOString(),
        sinceTimestamp: cutoffTimestamp,
        now: new Date(nowTimestamp).toISOString(),
        nowTimestamp: nowTimestamp,
        newPosts: newPosts,
        newComments: newComments,
        summary: {
          totalNewPosts: newPosts.length,
          totalNewComments: newComments.length
        }
      })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ 
        error: "Internal server error", 
        details: error.message 
      })
    };
  }
};
