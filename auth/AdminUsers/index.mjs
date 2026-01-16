import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const client = new DynamoDBClient({ region: 'eu-north-1', ...(process.env.DYNAMODB_URL && { endpoint: process.env.DYNAMODB_URL }) });
const docClient = DynamoDBDocumentClient.from(client);

export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event));
  
  try {
    const httpMethod = event.httpMethod;
    const userId = event.headers?.['x-user-id'] || event.headers?.['X-User-Id'];
    
    // Проверка админа (упрощенная - в production проверять роль из БД)
    if (!userId) {
      return {
        statusCode: 401,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({ error: "Unauthorized" })
      };
    }
    
    // GET - получить список пользователей
    if (httpMethod === 'GET') {
      const status = event.queryStringParameters?.status || 'pending';
      
      const scanParams = {
        TableName: "CMS-Users",
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status"
        },
        ExpressionAttributeValues: {
          ":status": status
        }
      };
      
      const result = await docClient.send(new ScanCommand(scanParams));
      
      // Убрать пароли из ответа
      const users = (result.Items || []).map(user => {
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
      });
      
      return {
        statusCode: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          users,
          count: users.length
        })
      };
    }
    
    // PUT - обновить статус пользователя
    if (httpMethod === 'PUT') {
      const targetUserId = event.pathParameters?.userId;
      const body = JSON.parse(event.body || '{}');
      const { status, role } = body;
      
      if (!targetUserId) {
        return {
          statusCode: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({ error: "User ID is required" })
        };
      }
      
      if (!status && !role) {
        return {
          statusCode: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({ error: "Status or role is required" })
        };
      }
      
      let updateExpression = "SET";
      const expressionAttributeValues = {};
      
      if (status) {
        updateExpression += " #status = :status";
        expressionAttributeValues[":status"] = status;
      }
      
      if (role) {
        if (status) updateExpression += ",";
        updateExpression += " #role = :role";
        expressionAttributeValues[":role"] = role;
      }
      
      const updateParams = {
        TableName: "CMS-Users",
        Key: { userId: targetUserId },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          "#status": "status",
          ...(role && { "#role": "role" })
        },
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: "ALL_NEW"
      };
      
      const result = await docClient.send(new UpdateCommand(updateParams));
      
      const { password, ...userWithoutPassword } = result.Attributes;
      
      return {
        statusCode: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify(userWithoutPassword)
      };
    }
    
    return {
      statusCode: 405,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Method not allowed" })
    };
    
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
