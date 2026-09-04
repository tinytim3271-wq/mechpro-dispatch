import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { requestContext, requireActiveAccount, AuthError } from '../common/auth';
import coverageBundle from './coverage-data.json';

export interface CoverageProcedure {
  supported: boolean;
  authorizationRequired: string | null;
}

export interface CoverageRecord {
  id: string;
  make: string;
  model: string;
  yearRange: [number, number];
  platform: string;
  ignitionType?: string;
  rfHubGen?: string;
  bcmGen?: string;
  gatewayArch?: string;
  region?: string;
  procedures: Record<string, CoverageProcedure>;
  preconditions: string[];
  warnings: string[];
  supported: string | boolean;
}

export function matchCoverageRecord(
  records: CoverageRecord[],
  platform: string,
  year: number,
): CoverageRecord | undefined {
  return records.find((record) => {
    const [start, end] = record.yearRange;
    return record.platform.toUpperCase() === platform.toUpperCase() && year >= start && year <= end;
  }) || records.find((record) => record.platform.toUpperCase() === platform.toUpperCase());
}

export function evaluateEligibility(
  record: CoverageRecord | undefined,
  procedure: string,
): { eligible: boolean; blockers: string[]; warnings: string[]; requiredAuth: string[] } {
  if (!record) {
    return {
      eligible: false,
      blockers: ['No coverage record for this platform and year.'],
      warnings: [],
      requiredAuth: [],
    };
  }
  const proc = record.procedures[procedure];
  if (!proc?.supported) {
    return {
      eligible: false,
      blockers: [`Procedure "${procedure}" is not supported on ${record.platform}.`],
      warnings: record.warnings,
      requiredAuth: [],
    };
  }
  return {
    eligible: true,
    blockers: [],
    warnings: record.warnings,
    requiredAuth: proc.authorizationRequired ? [proc.authorizationRequired] : [],
  };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  try {
    const ctx = requestContext(event);
    await requireActiveAccount(ctx);
    const path = event.rawPath || event.requestContext.http.path;
    const platform = String(event.queryStringParameters?.platform || '').trim();
    const year = Number(event.queryStringParameters?.year || 0);
    const records = coverageBundle.records as unknown as CoverageRecord[];

    if (path.endsWith('/bundle')) {
      return json(200, coverageBundle);
    }

    if (platform) {
      const match = year ? matchCoverageRecord(records, platform, year) : records.find((r) => r.platform.toUpperCase() === platform.toUpperCase());
      if (!match) return json(404, { message: 'No coverage record found' });
      return json(200, match);
    }

    return json(200, { coverageVersion: coverageBundle.coverageVersion, records });
  } catch (error) {
    if (error instanceof AuthError) return json(403, { message: error.message });
    console.error(error);
    return json(500, { message: 'Unable to load diagnostics coverage' });
  }
};
