using System.Text.Json;
using MechPro.J2534.Core;

namespace MechPro.J2534.Host;

public static class RpcDispatcher
{
    public static async Task<JsonRpcResponse> DispatchAsync(JsonRpcRequest request, DiagnosticSession session)
    {
        try
        {
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
                "clearDtcs" => await session.ClearDtcsAsync(),
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
