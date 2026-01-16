import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
};

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  try {
    const queryParams = event.queryStringParameters || {};
    const { tagId, limit = '20', lastKey } = queryParams;
    
    const scanLimit = Math.min(parseInt(limit, 10), 100); // Максимум 100
    
    let params = {
      TableName: "CMS-Posts",
      Limit: scanLimit,
      ScanIndexForward: false // Сортировка по убыванию (новые первые)
    };
    
    // Если указан lastKey для пагинации
    if (lastKey) {
      try {
        params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
      } catch (e) {
        console.error("Invalid lastKey:", e);
      }
    }
    
    let result;
    
    // Если фильтр по tagId - используем FilterExpression
    if (tagId) {
      params.FilterExpression = "contains(tags, :tagId)";
      params.ExpressionAttributeValues = {
        ":tagId": tagId
      };
      result = await docClient.send(new ScanCommand(params));
    } else {
      // Без фильтра - просто сканируем все посты
      result = await docClient.send(new ScanCommand(params));
    }
    
    // Сортировка по createdAt (новые первые)
    const posts = (result.Items || []).sort((a, b) => b.createdAt - a.createdAt);
    
    // Формировать nextKey для пагинации
    let nextKey = null;
    if (result.LastEvaluatedKey) {
      nextKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
    }
    
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        posts,
        count: posts.length,
        nextKey
      })
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
