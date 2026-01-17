import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

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
    const postId = event.pathParameters?.id;

    if (!postId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Post ID is required" })
      };
    } // ✅ Добавьте эту закрывающую скобку

    const queryParams = event.queryStringParameters || {};
    const { limit = '50', lastKey } = queryParams;
    const queryLimit = Math.min(parseInt(limit, 10), 100);

    let params = {
      TableName: "CMS-Comments",
      IndexName: "postId-index",
      KeyConditionExpression: "postId = :postId",
      ExpressionAttributeValues: {
        ":postId": postId
      },
      Limit: queryLimit,
      ScanIndexForward: true
    };

    if (lastKey) {
      try {
        params.ExclusiveStartKey = JSON.parse(decodeURIComponent(lastKey));
      } catch (e) {
        console.error("Invalid lastKey:", e);
      }
    }

    const result = await docClient.send(new QueryCommand(params));

    let nextKey = null;
    if (result.LastEvaluatedKey) {
      nextKey = encodeURIComponent(JSON.stringify(result.LastEvaluatedKey));
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        comments: result.Items || [],
        count: (result.Items || []).length,
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
