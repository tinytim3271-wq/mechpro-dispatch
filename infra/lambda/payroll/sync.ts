import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireRole, AuthError } from '../common/auth';

interface Order {
  id: string;
  status: string;
  tech: string;
  laborHours?: number;
  labor?: number;
}

interface Employee {
  id: string;
  techName?: string;
  payRate: number;
  employmentType: string;
  active: boolean;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Monday-anchored ISO week key, matching the client weekPeriod() convention. */
function weekPeriod(now = new Date()) {
  const day = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - day);
  const key = monday.toISOString().slice(0, 10);
  return { key, start: key };
}

/** Server-side port of syncAllPayroll: completed job labor hours become payroll entries for the assigned technician. */
export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    requireRole(ctx, ['admin', 'office']);
    const pk = `SHOP#${ctx.shopId}`;

    const [ordersResult, employeesResult] = await Promise.all([
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'ORDER#' },
      })),
      ddb.send(new QueryCommand({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk and begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': pk, ':prefix': 'EMPLOYEE#' },
      })),
    ]);

    const orders = (ordersResult.Items ?? []) as Order[];
    const employees = (employeesResult.Items ?? []) as Employee[];
    const period = weekPeriod();
    const posted: unknown[] = [];

    for (const order of orders) {
      if (!['completed', 'invoiced'].includes(order.status)) continue;
      const employee = employees.find(item => item.active && item.techName === order.tech);
      if (!employee) continue;
      const hours = Number(order.laborHours ?? (Number(order.labor || 0) / 165));
      if (!hours) continue;

      const entry = {
        pk,
        sk: `PAYROLLENTRY#${period.key}#${order.id}`,
        gsi1pk: `${pk}#TYPE#PAYROLLENTRY`,
        gsi1sk: `${period.key}#${order.id}`,
        workOrderId: order.id,
        employeeId: employee.id,
        periodKey: period.key,
        hours,
        rate: employee.payRate,
        grossPay: employee.employmentType === 'Hourly' ? hours * employee.payRate : 0,
        shopId: ctx.shopId,
        syncedAt: new Date().toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: entry }));
      posted.push(entry);
    }

    return json(200, { period: period.key, postedEntries: posted.length });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Internal error' });
  }
};
