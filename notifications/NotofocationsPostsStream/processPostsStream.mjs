import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
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
    
    console.log('Notification triggered:', type, data);
  } catch (error) {
    console.error('Failed to trigger notification:', error);
  }
}

export const handler = async (event) => {
  console.log('Processing posts stream:', JSON.stringify(event, null, 2));
  
  for (const record of event.Records) {
    try {
      // Обрабатываем только INSERT (создание) и MODIFY (редактирование)
      if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
        const newImage = unmarshall(record.dynamodb.NewImage);
        
        console.log('Processing post:', newImage.postId, 'Event:', record.eventName);
        
        // Проверяем упоминания в контенте
        const mentions = extractMentions(newImage.content);
        
        if (mentions.length > 0) {
          console.log('Found mentions:', mentions);
          
          await sendNotifications('POST_MENTION', {
            authorUsername: newImage.username,
            postTitle: newImage.title,
            postUrl: `https://txt-me.club/posts/${newImage.postId}`,
            content: newImage.content
          });
        }
      }
    } catch (error) {
      console.error('Error processing record:', error);
      // Продолжаем обработку следующих записей
    }
  }
  
  return { statusCode: 200, body: 'OK' };
};
