using System.Collections.Concurrent;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MechPro.J2534.Host;

/// <summary>
/// HMAC-signed clear_dtcs capability tokens. Compatible with
/// infra/lambda/diagnostics/capability-token.ts and the Node host verifier.
/// </summary>
public static class CapabilityToken
{
    static readonly ConcurrentDictionary<string, byte> Consumed = new();

    public static void VerifyClearDtcs(string? token)
    {
        var raw = (token ?? string.Empty).Trim();
        var parts = raw.Split('.');
        if (parts.Length != 3 || parts[0] != "v1")
        {
            throw new UnauthorizedAccessException("Invalid diagnostics capability token");
        }

        var payloadJson = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
        var expectedSig = Sign(payloadJson);
        if (!FixedTimeEquals(expectedSig, parts[2]))
        {
            throw new UnauthorizedAccessException("Invalid diagnostics capability token signature");
        }

        using var doc = JsonDocument.Parse(payloadJson);
        var root = doc.RootElement;
        if (root.GetProperty("v").GetInt32() != 1
            || root.GetProperty("procedure").GetString() != "clear_dtcs")
        {
            throw new UnauthorizedAccessException("Capability token is not valid for clearDtcs");
        }

        var vin = root.GetProperty("vin").GetString();
        var shopId = root.GetProperty("shopId").GetString();
        var jti = root.GetProperty("jti").GetString();
        var exp = root.GetProperty("exp").GetInt64();
        if (string.IsNullOrWhiteSpace(vin) || string.IsNullOrWhiteSpace(shopId) || string.IsNullOrWhiteSpace(jti))
        {
            throw new UnauthorizedAccessException("Capability token payload is incomplete");
        }

        if (DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > exp)
        {
            throw new UnauthorizedAccessException("Capability token expired");
        }

        if (!Consumed.TryAdd(jti, 0))
        {
            throw new UnauthorizedAccessException("Capability token already used");
        }

        if (Consumed.Count > 500)
        {
            foreach (var key in Consumed.Keys.Take(50))
            {
                Consumed.TryRemove(key, out _);
            }
        }
    }

    static string Sign(string payloadJson)
    {
        var secret = Environment.GetEnvironmentVariable("MECHPRO_DIAG_CAPABILITY_SECRET")
            ?? Environment.GetEnvironmentVariable("DIAGNOSTICS_CAPABILITY_SECRET")
            ?? "mechpro-dev-diagnostics-capability-v1";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Base64UrlEncode(hmac.ComputeHash(Encoding.UTF8.GetBytes(payloadJson)));
    }

    static bool FixedTimeEquals(string a, string b)
    {
        var left = Encoding.UTF8.GetBytes(a);
        var right = Encoding.UTF8.GetBytes(b);
        return left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
    }

    static string Base64UrlEncode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    static byte[] Base64UrlDecode(string input)
    {
        var padded = input.Replace('-', '+').Replace('_', '/');
        switch (padded.Length % 4)
        {
            case 2: padded += "=="; break;
            case 3: padded += "="; break;
        }
        return Convert.FromBase64String(padded);
    }
}
