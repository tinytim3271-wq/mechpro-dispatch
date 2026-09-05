using System.Text.Json;
using MechPro.J2534.Core;

namespace MechPro.J2534.Host;

public static class RpcDispatcher
{
    static readonly string? HostToken = Environment.GetEnvironmentVariable("MECHPRO_J2534_TOKEN");

    public static async Task<JsonRpcResponse> DispatchAsync(JsonRpcRequest request, DiagnosticSession session)
    {
        try
        {
            AssertAuth(request.Params);
            var result = request.Method switch
            {
                "ping" => new { ok = true, simulator = session.IsSimulator },
                "listAdapters" => AdapterRegistry.ListAdapters(),
                "connect" => session.Connect(ParseConnect(request.Params)),
                "disconnect" => session.Disconnect(),
                "getConnectionStatus" => session.GetConnectionStatus(),
                "readVin" => await session.ReadVinAsync(),
                "identifyEcus" => await session.IdentifyEcusAsync(),
                "readDtcs" => await session.ReadDtcsAsync(),
                "clearDtcs" => await ClearDtcs(request.Params, session),
                "startLiveLog" => session.StartLiveLog(),
                "stopLiveLog" => session.StopLiveLog(),
                "pollLiveLog" => session.PollLiveLog(ParseSince(request.Params)),
                "identifyVehicle" => await session.IdentifyVehicleAsync(),
                _ => throw new InvalidOperationException($"Unknown method: {request.Method}"),
            };
            return JsonRpcResponse.Ok(request.Id, result);
        }
        catch (Exception ex)
        {
            return JsonRpcResponse.Fail(request.Id, -32000, ex.Message);
        }
    }

    static async Task<object> ClearDtcs(JsonElement? element, DiagnosticSession session)
    {
        string? authorizationToken = null;
        if (element is not null && element.Value.TryGetProperty("authorizationToken", out var token))
        {
            authorizationToken = token.GetString();
        }
        CapabilityToken.VerifyClearDtcs(authorizationToken);
        return await session.ClearDtcsAsync();
    }

    static void AssertAuth(JsonElement? element)
    {
        if (string.IsNullOrEmpty(HostToken)) return;
        if (element is null || !element.Value.TryGetProperty("authToken", out var token)
            || token.GetString() != HostToken)
        {
            throw new UnauthorizedAccessException("Unauthorized J2534 RPC — invalid host token");
        }
    }

    static ConnectParams ParseConnect(JsonElement? element)
    {
        if (element is null) return new ConnectParams();
        return JsonSerializer.Deserialize<ConnectParams>(element.Value.GetRawText(), JsonOptions.Rpc) ?? new ConnectParams();
    }

    static long ParseSince(JsonElement? element)
    {
        if (element is null || !element.Value.TryGetProperty("since", out var since)) return 0;
        return since.GetInt64();
    }
}
