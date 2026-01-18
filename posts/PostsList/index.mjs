import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({
  region: 'eu-north-1',
  ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL })
});
const docClient = DynamoDBDocumentClient.from(client);

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,x-user-id,Authorization",
  "Access-Control-Allow-Methods": "OPTIONS,POST,GET,PUT,DELETE"
};

/**
 * Feed без фильтра по тегу
 */
async function feed({ limit, lastKey }) {
  let params = {
    TableName: "CMS-Posts",
    Limit: limit,
    ScanIndexForward: false // Сортировка по убыванию (новые первые)
  };

  // Если указан lastKey для пагинации
  if (lastKey) {
    params.ExclusiveStartKey = lastKey;
  }

  // Используем индекс для получения списка постов
  params.IndexName = "feed-index";
  params.KeyConditionExpression = "#t = :type";
  params.ExpressionAttributeNames = { "#t": "type" };
  params.ExpressionAttributeValues = { ":type": "POST" };

  const result = await docClient.send(new QueryCommand(params));

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      posts: result.Items || [],
      count: (result.Items || []).length,
      nextKey: result.LastEvaluatedKey
          ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
          : null
    })
  };
}

/**
 * Feed с фильтром по tagId
 */
async function feedWithTag({ tagId, limit, lastKey }) {
  let params = {
    TableName: "CMS-Posts",
    Limit: limit,
    ScanIndexForward: false // Сортировка по убыванию (новые первые)
  };

  // Если указан lastKey для пагинации
  if (lastKey) {
    params.ExclusiveStartKey = lastKey;
  }

  // Если фильтр по tagId - используем FilterExpression
  // Оставляем Scan с фильтром для тегов (как временное решение)
  params.FilterExpression = "contains(tags, :tagId)";
  params.ExpressionAttributeValues = {
    ":tagId": tagId
  };

  const result = await docClient.send(new ScanCommand(params));

  // При использовании QueryCommand с ScanIndexForward: false,
  // данные уже приходят отсортированными от новых к старым.
  // Сортировка вручную остается только для случая Scan (с тегами).
  const posts = result.Items || [];
  posts.sort((a, b) => b.createdAt - a.createdAt);

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      posts,
      count: posts.length,
      nextKey: result.LastEvaluatedKey
          ? encodeURIComponent(JSON.stringify(result.LastEvaluatedKey))
          : null
    })
  };
}

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));

  try {
    const queryParams = event.queryStringParameters || {};
    const { tagId, limit = '20', lastKey } = queryParams;

    const scanLimit = Math.min(parseInt(limit, 10), 100); // Максимум 100

    const decodedLastKey = lastKey
        ? JSON.parse(decodeURIComponent(lastKey))
        : undefined;


    // TODO: better move filtering by tag to another Lambda
    if (tagId) {
      return feedWithTag({
        tagId,
        limit: scanLimit,
        lastKey: decodedLastKey
      });
    }
    // TODO: better move filtering by tag to another Lambda


    return feed({
      limit: scanLimit,
      lastKey: decodedLastKey
    });

  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
