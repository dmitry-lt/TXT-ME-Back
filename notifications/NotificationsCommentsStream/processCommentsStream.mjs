import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);
const lambdaClient = new LambdaClient({ region: 'eu-north-1' });

// Функция извлечения @mentions
function extractMentions(content) {
  if (!content) return [];
  const regex = /@([a-zA-Z0-9_-]+)/g;
  const mentions = [];
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    mentions.push(match[1]);
  }
  
  return [...new Set(mentions)];
}

// Функция отправки уведомлений
async function sendNotifications(type, data) {
  try {
    const payload = JSON.stringify({ type, data });
    
    await lambdaClient.send(new InvokeCommand({
      FunctionName: 'CMS-Notifications-SendEmail',
      InvocationType: 'Event',
      Payload: payload
    }));
    
    console.log('Notification triggered:', type);
  } catch (error) {
    console.error('Failed to trigger notification:', error);
  }
}

export const handler = async (event) => {
  console.log('Processing comments stream:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      // Обрабатываем только INSERT (новые комментарии)
      if (record.eventName === 'INSERT') {
        const comment = unmarshall(record.dynamodb.NewImage);
        
        console.log('Processing comment:', comment.commentId);
        
        // Получаем информацию о посте
        const postResult = await dynamodb.send(new GetCommand({
          TableName: 'CMS-Posts',
          Key: { postId: comment.postId }
        }));
        
        const post = postResult.Item;
        
        if (!post) {
          console.error('Post not found:', comment.postId);
          continue;
        }
        
        // Вариант 2: Уведомление об ответе на пост/комментарий
        let parentCommentAuthorUsername = null;
        let parentCommentAuthorUserId = null;
        
        if (comment.parentCommentId) {
          // Получаем родительский комментарий через Query
          const commentsResult = await dynamodb.send(new QueryCommand({
            TableName: 'CMS-Comments',
            IndexName: 'postId-index',
            KeyConditionExpression: 'postId = :postId',
            ExpressionAttributeValues: {
              ':postId': comment.postId
            }
          }));
          
          const parentComment = commentsResult.Items?.find(c => c.commentId === comment.parentCommentId);
          
          if (parentComment) {
            parentCommentAuthorUsername = parentComment.username;
            parentCommentAuthorUserId = parentComment.userId;
          }
        }
        
        // Отправляем уведомление об ответе
        await sendNotifications('COMMENT_REPLY', {
          authorUsername: comment.username,
          authorUserId: comment.userId,
          postTitle: post.title,
          postUrl: `https://txt-me.club/posts/${comment.postId}`,
          postAuthorUserId: post.userId,
          parentCommentAuthorUserId,
          parentCommentAuthorUsername
        });
        
        // Вариант 3: Упоминания в комментарии
        const mentions = extractMentions(comment.content);
        
        if (mentions.length > 0) {
          console.log('Found mentions in comment:', mentions);
          
          await sendNotifications('COMMENT_MENTION', {
            authorUsername: comment.username,
            postTitle: post.title,
            postUrl: `https://txt-me.club/posts/${comment.postId}`,
            content: comment.content
          });
        }
      }
    } catch (error) {
      console.error('Error processing record:', error);
    }
  }
  
  return { statusCode: 200, body: 'OK' };
};
