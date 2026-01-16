import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const sesClient = new SESClient({ region: 'eu-north-1' });
const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const dynamodb = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event));
  
  const { type, data } = typeof event.body === 'string' ? JSON.parse(event.body) : event;
  
  try {
    let recipients = [];
    let subject = '';
    let bodyText = '';
    
    if (type === 'POST_MENTION') {
      const mentions = extractMentions(data.content);
      console.log('Found mentions in post:', mentions);
      recipients = await getUserEmailsByUsernames(mentions);
      subject = `${data.authorUsername} упомянул вас в тексте`;
      bodyText = `Пользователь ${data.authorUsername} упомянул вас в тексте "${data.postTitle}" по ссылке ${data.postUrl}`;
      
    } else if (type === 'COMMENT_REPLY') {
      const emails = [];
      
      if (data.postAuthorUserId && data.postAuthorUserId !== data.authorUserId) {
        const postAuthorEmail = await getUserEmailByUserId(data.postAuthorUserId);
        if (postAuthorEmail) emails.push(postAuthorEmail);
      }
      
      if (data.parentCommentAuthorUserId && 
          data.parentCommentAuthorUserId !== data.authorUserId &&
          data.parentCommentAuthorUserId !== data.postAuthorUserId) {
        const parentEmail = await getUserEmailByUserId(data.parentCommentAuthorUserId);
        if (parentEmail) emails.push(parentEmail);
      }
      
      recipients = [...new Set(emails)];
      subject = `${data.authorUsername} ответил на ваш текст`;
      
      const parentInfo = data.parentCommentAuthorUsername 
        ? ` на комментарий ${data.parentCommentAuthorUsername}` 
        : '';
      bodyText = `Пользователь ${data.authorUsername} ответил на ваш текст "${data.postTitle}"${parentInfo} по ссылке ${data.postUrl}`;
      
    } else if (type === 'COMMENT_MENTION') {
      const mentions = extractMentions(data.content);
      console.log('Found mentions in comment:', mentions);
      recipients = await getUserEmailsByUsernames(mentions);
      subject = `${data.authorUsername} упомянул вас в комментарии`;
      bodyText = `Пользователь ${data.authorUsername} упомянул вас в комментарии к тексту "${data.postTitle}" по ссылке ${data.postUrl}`;
    }
    
    console.log('Recipients:', recipients);
    
    let sentCount = 0;
    for (const email of recipients) {
      if (!email) continue;
      
      try {
        await sesClient.send(new SendEmailCommand({
          Source: 'noreply@txt-me',
          Destination: { ToAddresses: [email] },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: bodyText, Charset: 'UTF-8' }
            }
          }
        }));
        sentCount++;
        console.log(`Email sent to ${email}`);
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error);
      }
    }
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Notifications sent', count: sentCount })
    };
    
  } catch (error) {
    console.error('Failed to send notifications:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

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

async function getUserEmailByUserId(userId) {
  if (!userId) return null;
  
  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: 'CMS-Users',
      Key: { userId }
    }));
    
    return result.Item?.email || null;
  } catch (error) {
    console.error(`Failed to get email for userId ${userId}:`, error);
    return null;
  }
}

async function getUserEmailsByUsernames(usernames) {
  if (!usernames || usernames.length === 0) return [];
  
  const emails = [];
  
  for (const username of usernames) {
    try {
      const result = await dynamodb.send(new QueryCommand({
        TableName: 'CMS-Users',
        IndexName: 'username-index',
        KeyConditionExpression: 'username = :username',
        ExpressionAttributeValues: {
          ':username': username
        }
      }));
      
      if (result.Items && result.Items.length > 0 && result.Items[0].email) {
        emails.push(result.Items[0].email);
      }
    } catch (error) {
      console.error(`Failed to get email for username ${username}:`, error);
    }
  }
  
  return emails;
}
