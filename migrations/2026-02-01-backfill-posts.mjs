/**
 * МИГРАЦИЯ: Добавление синтетического ключа для пагинации (ленты постов).
 * * ПОЧЕМУ ЭТО НУЖНО:
 * В DynamoDB запрос (Query) работает только внутри одной партиции. В нашей таблице
 * Partition Key — это 'postId'. Это значит, что каждый пост лежит в своей "коробке",
 * и мы не можем эффективно получить список всех постов, отсортированных по времени.
 * * ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ:
 * 1. Проходит по всем записям в таблице CMS-Posts через операцию Scan.
 * 2. Добавляет каждой записи атрибут "feedKey" со строковым значением "GLOBAL".
 * 3. Это позволяет Global Secondary Index (feedKey-createdAt-index) собрать все посты
 * в одну виртуальную партицию, где они будут отсортированы по 'createdAt'.
 * 4. Также переносит теги постов в таблицу CMS-TagPosts для эффективной фильтрации.
 * * ПОСЛЕДСТВИЯ:
 * После завершения миграции индекс 'feedKey-createdAt-index' наполнится автоматически.
 * Это позволит делать пагинацию (Query) по всей ленте без использования дорогого Scan.
 * * ЗАПУСК:
 * Локально: node 2026-02-01-backfill-posts.mjs --local
 * В облаке: node 2026-02-01-backfill-posts.mjs
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

const POSTS_TABLE = 'CMS-Posts';
const TAG_POSTS_TABLE = 'CMS-TagPosts';
const REGION = "eu-north-1";

const isLocal = process.argv.includes('--local');

// Configure DynamoDB client
const client = new DynamoDBClient({ 
  region: REGION,
  ...(isLocal && {
    endpoint: process.env.DYNAMODB_URL || "http://localhost:8000",
    credentials: {
      accessKeyId: "local",
      secretAccessKey: "local"
    }
  })
});
const docClient = DynamoDBDocumentClient.from(client);

async function backfill() {
  try {
    console.log(`🚀 Начинаем миграцию таблицы ${POSTS_TABLE}...`);
    
    let lastEvaluatedKey = undefined;
    let totalProcessed = 0;
    let totalUpdated = 0;
    let totalTagsCreated = 0;

    do {
      const scanResult = await docClient.send(new ScanCommand({
        TableName: POSTS_TABLE,
        ExclusiveStartKey: lastEvaluatedKey,
      }));

      const items = scanResult.Items || [];
      console.log(`\n📦 Считано ${items.length} записей, обрабатываем...`);

      for (const post of items) {
        totalProcessed++;

        // 1. Update CMS-Posts with feedKey="GLOBAL"
        if (!post.feedKey) {
          await docClient.send(new UpdateCommand({
            TableName: POSTS_TABLE,
            Key: { postId: post.postId },
            UpdateExpression: 'SET feedKey = :fk',
            ExpressionAttributeValues: {
              ':fk': 'GLOBAL',
            },
          }));
          totalUpdated++;
        }

        // 2. Create entries in CMS-TagPosts for each tag
        if (post.tags && Array.isArray(post.tags)) {
          for (const tag of post.tags) {
            await docClient.send(new PutCommand({
              TableName: TAG_POSTS_TABLE,
              Item: {
                tag: tag,
                createdAt: post.createdAt,
                postId: post.postId,
              },
            }));
            totalTagsCreated++;
          }
        }
        process.stdout.write('.'); // Индикатор прогресса
      }

      lastEvaluatedKey = scanResult.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`\n\n✅ Миграция завершена!`);
    console.log(`📊 Всего обработано записей: ${totalProcessed}`);
    console.log(`📊 Всего обновлено записей (feedKey=GLOBAL): ${totalUpdated}`);
    console.log(`📊 Всего создано связей с тегами: ${totalTagsCreated}`);

  } catch (error) {
    console.error('\n❌ Ошибка при миграции:', error);
    process.exit(1);
  }
}

backfill();
