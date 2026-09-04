import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, TABLE_NAME } from '../common/ddb';
import { requestContext, requireActiveAccount, AuthError } from '../common/auth';

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended';

export function validVin(value: unknown): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(String(value || '').trim().toUpperCase());
}

export function normalizeVinResult(result: Record<string, unknown>) {
  const text = (key: string) => String(result[key] || '').trim();
  return {
    vin: text('VIN').toUpperCase(),
    year: text('ModelYear'),
    make: text('Make'),
    model: text('Model'),
    trim: text('Trim'),
    vehicleType: text('VehicleType'),
    bodyClass: text('BodyClass'),
    driveType: text('DriveType'),
    fuelType: text('FuelTypePrimary'),
    engineCylinders: text('EngineCylinders'),
    engineDisplacementLiters: text('DisplacementL'),
    manufacturer: text('Manufacturer'),
    plantCountry: text('PlantCountry'),
    errorCode: text('ErrorCode'),
    errorText: text('ErrorText'),
  };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    const vin = String(event.pathParameters?.vin || '').trim().toUpperCase();
    if (!validVin(vin)) return json(400, { message: 'VIN must contain 17 valid characters' });

    const key = { pk: `SHOP#${ctx.shopId}`, sk: `VINDECODE#${vin}` };
    const cached = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: key }));
    if (cached.Item?.decoded) return json(200, { ...cached.Item.decoded, cached: true });

    const response = await fetch(`${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return json(502, { message: 'Vehicle data provider is unavailable' });
    const payload = await response.json() as { Results?: Record<string, unknown>[] };
    const decoded = normalizeVinResult(payload.Results?.[0] || {});
    if (!decoded.make && !decoded.model && !decoded.year) {
      return json(422, { message: decoded.errorText || 'No vehicle details were found for this VIN' });
    }
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...key, decoded, updatedAt: new Date().toISOString(), source: 'NHTSA vPIC' },
    }));
    return json(200, { ...decoded, cached: false });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    if ((error as { name?: string }).name === 'TimeoutError') return json(504, { message: 'Vehicle data provider timed out' });
    console.error(error);
    return json(500, { message: 'Unable to decode VIN' });
  }
};