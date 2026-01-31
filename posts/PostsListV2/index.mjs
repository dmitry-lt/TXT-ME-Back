import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ 
  region: 'eu-north-1', 
  ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) 
});
const dynamodb = DynamoDBDocumentClient.from(client);

const POSTS_TABLE = 'CMS-Posts';
const TAG_POSTS_TABLE = 'CMS-TagPosts';
const USERS_TABLE = 'CMS-Users';

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const { 
      author, 
      tag, 
      day, 
      since, 
      until, 
      limit = '10' 
    } = event.queryStringParameters || {};

    const pageSize = parseInt(limit, 10);
    
    if (since && until) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'since and until are mutually exclusive' }),
      };
    }

    let items = [];
    let queryParams = {
      Limit: pageSize,
      ScanIndexForward: false, // Default to newest first
    };

    // 1. Determine the mode and query target
    if (tag) {
      // TAG FILTER MODE
      queryParams.TableName = TAG_POSTS_TABLE;
      queryParams.KeyConditionExpression = '#t = :tag';
      queryParams.ExpressionAttributeNames = { '#t': 'tag' };
      queryParams.ExpressionAttributeValues = { ':tag': tag };
      
      applyPagination(queryParams, since, until);
      
      const result = await dynamodb.send(new QueryCommand(queryParams));
      const tagMappings = result.Items || [];
      
      if (tagMappings.length > 0) {
        // Hydrate full posts
        items = await hydratePosts(tagMappings.map(m => m.postId), tagMappings);
      }
    } else if (author) {
      // AUTHOR FILTER MODE
      // First resolve username to userId
      const userResult = await dynamodb.send(new QueryCommand({
        TableName: USERS_TABLE,
        IndexName: 'username-index',
        KeyConditionExpression: 'username = :u',
        ExpressionAttributeValues: { ':u': author },
      }));

      const user = userResult.Items?.[0];
      if (!user) {
        return { statusCode: 200, headers, body: JSON.stringify({ items: [], page: {} }) };
      }

      queryParams.TableName = POSTS_TABLE;
      queryParams.IndexName = 'userId-createdAt-index';
      queryParams.KeyConditionExpression = 'userId = :uid';
      queryParams.ExpressionAttributeValues = { ':uid': user.userId };
      
      applyPagination(queryParams, since, until);
      
      const result = await dynamodb.send(new QueryCommand(queryParams));
      const keys = result.Items || [];
      if (keys.length > 0) {
        items = await hydratePosts(keys.map(k => k.postId), keys);
      }
    } else if (day) {
      // DAY VIEW MODE (UTC)
      const startMs = Date.parse(`${day}T00:00:00.000Z`);
      if (isNaN(startMs)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid day format. Use YYYY-MM-DD' }) };
      }
      const endMs = startMs + 86400000 - 1;

      queryParams.TableName = POSTS_TABLE;
      queryParams.IndexName = 'feedKey-createdAt-index';
      queryParams.KeyConditionExpression = 'feedKey = :fk AND createdAt BETWEEN :start AND :end';
      queryParams.ExpressionAttributeValues = { 
        ':fk': 'GLOBAL',
        ':start': startMs,
        ':end': endMs
      };
      
      applyPagination(queryParams, since, until, true); // true means bounded by day
      
      const result = await dynamodb.send(new QueryCommand(queryParams));
      const keys = result.Items || [];
      if (keys.length > 0) {
        items = await hydratePosts(keys.map(k => k.postId), keys);
      }
    } else {
      // GLOBAL FEED MODE
      queryParams.TableName = POSTS_TABLE;
      queryParams.IndexName = 'feedKey-createdAt-index';
      queryParams.KeyConditionExpression = 'feedKey = :fk';
      queryParams.ExpressionAttributeValues = { ':fk': 'GLOBAL' };
      
      applyPagination(queryParams, since, until);
      
      const result = await dynamodb.send(new QueryCommand(queryParams));
      const keys = result.Items || [];
      if (keys.length > 0) {
        items = await hydratePosts(keys.map(k => k.postId), keys);
      }
    }

    // Prepare response with page metadata
    const response = {
      items: items,
      page: {}
    };

    if (items.length > 0) {
      // If we queried with until, the items were returned in ascending order (older to newer)
      // because ScanIndexForward was true. We need to reverse them to keep newest first.
      if (until) {
        items.reverse();
      }

      response.page.nextSince = items[items.length - 1].createdAt;
      response.page.prevUntil = items[0].createdAt;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message }),
    };
  }
};

function applyPagination(queryParams, since, until, isBounded = false) {
  const sinceMs = since ? parseInt(since, 10) : null;
  const untilMs = until ? parseInt(until, 10) : null;

  if (sinceMs) {
    // Older than since
    if (isBounded) {
      // We already have BETWEEN :start AND :end
      // We need to adjust :end to be sinceMs - 1
      queryParams.ExpressionAttributeValues[':end'] = Math.min(queryParams.ExpressionAttributeValues[':end'], sinceMs - 1);
    } else {
      queryParams.KeyConditionExpression += ' AND createdAt < :since';
      queryParams.ExpressionAttributeValues[':since'] = sinceMs;
    }
    queryParams.ScanIndexForward = false;
  } else if (untilMs) {
    // Newer than until
    if (isBounded) {
      // Adjust :start to be untilMs + 1
      queryParams.ExpressionAttributeValues[':start'] = Math.max(queryParams.ExpressionAttributeValues[':start'], untilMs + 1);
    } else {
      queryParams.KeyConditionExpression += ' AND createdAt > :until';
      queryParams.ExpressionAttributeValues[':until'] = untilMs;
    }
    queryParams.ScanIndexForward = true; // Ascending to get items closest to until
  }
}

async function hydratePosts(postIds, orderedKeys) {
  // BatchGetItem is unordered, so we need to map results back to orderedKeys
  const uniquePostIds = [...new Set(postIds)];
  
  const results = [];
  // BatchGet can only take 100 items at a time
  for (let i = 0; i < uniquePostIds.length; i += 100) {
    const chunk = uniquePostIds.slice(i, i + 100);
    const result = await dynamodb.send(new BatchGetCommand({
      RequestItems: {
        [POSTS_TABLE]: {
          Keys: chunk.map(id => ({ postId: id }))
        }
      }
    }));
    results.push(...(result.Responses[POSTS_TABLE] || []));
  }

  const postMap = results.reduce((acc, post) => {
    acc[post.postId] = post;
    return acc;
  }, {});

  // Return posts in the order of orderedKeys
  return orderedKeys
    .map(key => postMap[key.postId])
    .filter(post => !!post);
}
