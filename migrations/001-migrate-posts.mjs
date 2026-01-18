/**
 * МИГРАЦИЯ: Добавление синтетического ключа для пагинации (ленты постов).
 * * ПОЧЕМУ ЭТО НУЖНО:
 * В DynamoDB запрос (Query) работает только внутри одной партиции. В нашей таблице
 * Partition Key — это 'postId'. Это значит, что каждый пост лежит в своей "коробке",
 * и мы не можем эффективно получить список всех постов, отсортированных по времени.
 * * ЧТО ДЕЛАЕТ ЭТОТ СКРИПТ:
 * 1. Проходит по всем записям в таблице CMS-Posts через операцию Scan.
 * 2. Добавляет каждой записи атрибут "type" со строковым значением "POST".
 * 3. Это позволяет Global Secondary Index (feed-index) собрать все посты
 * в одну виртуальную партицию, где они будут отсортированы по 'createdAt'.
 * * ПОСЛЕДСТВИЯ:
 * После завершения миграции индекс 'feed-index' наполнится автоматически.
 * Это позволит делать пагинацию (Query) по всей ленте без использования дорогого Scan.
 * * ЗАПУСК:
 * Локально: node 001-migrate-posts.mjs --local
 * В облаке: node 001-migrate-posts.mjs
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = "CMS-Posts";
const REGION = "eu-north-1";

const isLocal = process.argv.includes('--local');

const client = new DynamoDBClient({
    region: REGION,
    ...(isLocal && {
        endpoint: "http://localhost:8000",
        credentials: {
            accessKeyId: "local",
            secretAccessKey: "local"
        }
    })
});

const docClient = DynamoDBDocumentClient.from(client);

async function startMigration() {
    console.log(`🚀 Начинаем миграцию таблицы ${TABLE_NAME}...`);

    let lastKey = null;
    let totalUpdated = 0;

    try {
        do {
            // 1. Сканируем таблицу порциями
            const scanParams = {
                TableName: TABLE_NAME,
                ...(lastKey && { ExclusiveStartKey: lastKey }),
            };

            const scanResult = await docClient.send(new ScanCommand(scanParams));
            const items = scanResult.Items || [];

            console.log(`\n📦 Считано ${items.length} записей, обрабатываем...`);

            // 2. Обновляем каждую запись
            for (const item of items) {
                // Проверяем, нужно ли обновлять (чтобы не тратить ресурсы)
                if (item.type === "POST") continue;

                await docClient.send(new UpdateCommand({
                    TableName: TABLE_NAME,
                    Key: { postId: item.postId }, // Первичный ключ вашей таблицы
                    UpdateExpression: "SET #t = :val",
                    ExpressionAttributeNames: { "#t": "type" },
                    ExpressionAttributeValues: { ":val": "POST" }
                }));

                totalUpdated++;
                process.stdout.write('.'); // Индикатор прогресса
            }

            lastKey = scanResult.LastEvaluatedKey;

        } while (lastKey);

        console.log(`\n\n✅ Миграция завершена!`);
        console.log(`📊 Всего обновлено записей: ${totalUpdated}`);

    } catch (error) {
        console.error("\n❌ Ошибка при миграции:", error);
    }
}

startMigration();