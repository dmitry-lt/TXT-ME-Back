import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import jwt from 'jsonwebtoken';

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

    // Determine viewer max visibility
    let maxVisibility = 0; // Default for anonymous
    const token = event.headers.Authorization?.replace('Bearer ', '') || 
                  event.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      try {
        const JWT_SECRET = process.env.JWT_SECRET || 'cms-jwt-secret-prod-2025';
        const decoded = jwt.verify(token, JWT_SECRET);
        const userRole = decoded.role || 'KOMMENTATOR';
        
        const roleMaxVisibility = {
          'KOMMENTATOR': 10,
          'AVTOR': 20,
          'SMOTRITEL': 30,
          'NASTOIATEL': 40
        };
        maxVisibility = roleMaxVisibility[userRole] || 10;
      } catch (e) {
        console.error('JWT verification failed:', e);
      }
    }

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
      Limit: pageSize + 1,
      ScanIndexForward: false, // Default to newest first
      FilterExpression: 'attribute_not_exists(visibilityLevel) OR visibilityLevel <= :max',
      ExpressionAttributeValues: { ':max': maxVisibility }
    };

    // 1. Determine the mode and query target
    if (tag) {
      // TAG FILTER MODE
      queryParams.TableName = TAG_POSTS_TABLE;
      queryParams.KeyConditionExpression = '#t = :tag';
      queryParams.ExpressionAttributeNames = { '#t': 'tag' };
      queryParams.ExpressionAttributeValues[':tag'] = tag;
      
      applyPagination(queryParams, since, until);
      
      const tagMappings = await fetchWithFilling(queryParams, pageSize);
      
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
      queryParams.ExpressionAttributeValues[':uid'] = user.userId;
      
      applyPagination(queryParams, since, until);
      
      const keys = await fetchWithFilling(queryParams, pageSize);
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
      queryParams.ExpressionAttributeValues[':fk'] = 'GLOBAL';
      queryParams.ExpressionAttributeValues[':start'] = startMs;
      queryParams.ExpressionAttributeValues[':end'] = endMs;
      
      applyPagination(queryParams, since, until, true); // true means bounded by day
      
      const keys = await fetchWithFilling(queryParams, pageSize);
      if (keys.length > 0) {
        items = await hydratePosts(keys.map(k => k.postId), keys);
      }
    } else {
      // GLOBAL FEED MODE
      queryParams.TableName = POSTS_TABLE;
      queryParams.IndexName = 'feedKey-createdAt-index';
      queryParams.KeyConditionExpression = 'feedKey = :fk';
      queryParams.ExpressionAttributeValues[':fk'] = 'GLOBAL';
      
      applyPagination(queryParams, since, until);
      
      const keys = await fetchWithFilling(queryParams, pageSize);
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
      const hasMoreInQueryDirection = items.length > pageSize;
      if (hasMoreInQueryDirection) {
        items.pop();
      }

      // If we queried with until, the items were returned in ascending order (older to newer)
      // because ScanIndexForward was true. We need to reverse them to keep newest first.
      if (until) {
        items.reverse();
      }

      // Pagination logic:
      // 1. nextSince (Older) exists if:
      //    - We are moving forward (no until) and there's more data.
      //    - OR we are moving backward (until), then we can always go further back (since we started from somewhere).
      if ((!until && hasMoreInQueryDirection) || until) {
        response.page.nextSince = items[items.length - 1].createdAt;
      }

      // 2. prevUntil (Newer) exists if:
      //    - We are moving backward (until) and there's more data.
      //    - OR we are moving forward (since), then we can always go back to where we came from.
      if ((until && hasMoreInQueryDirection) || since) {
        response.page.prevUntil = items[0].createdAt;
      }
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

async function fetchWithFilling(params, pageSize) {
  const collectedItems = [];
  let currentParams = { ...params };
  let lastKey = null;

  do {
    if (lastKey) {
      currentParams.ExclusiveStartKey = lastKey;
    }
    
    // Adjust Limit: we need (pageSize + 1) items TOTAL, but we might have some already.
    // However, DynamoDB's Limit is on items READ, not items RETURNED after FilterExpression.
    // So we use a reasonable chunk size.
    currentParams.Limit = Math.max(pageSize * 2, 50);

    const result = await dynamodb.send(new QueryCommand(currentParams));
    const items = result.Items || [];
    collectedItems.push(...items);
    
    lastKey = result.LastEvaluatedKey;
    
    // Stop if we have enough items OR no more items to fetch
  } while (collectedItems.length <= pageSize && lastKey);

  return collectedItems;
}
