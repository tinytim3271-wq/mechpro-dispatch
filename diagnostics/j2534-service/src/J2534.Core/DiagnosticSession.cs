using MechPro.J2534.IsoTp;
using MechPro.J2534.Uds;

namespace MechPro.J2534.Core;

/// <summary>Manages a single J2534 diagnostic session with ISO-TP and UDS services.</summary>
public sealed class DiagnosticSession
{
    readonly List<CommLogEntry> _commLog = [];
    bool _connected;
    string? _adapterId;
    string? _protocol;
    double _voltage = 12.6;
    bool _liveLogActive;

    public object Connect(ConnectParams p)
    {
        _connected = true;
        _adapterId = p.AdapterId ?? "default";
        _protocol = p.Protocol ?? "ISO15765";
        Log("tx", "0x7E0", "1003", "Diagnostic session start");
        Log("rx", "0x7E8", "5003", "Positive response");
        return new { connected = true, protocol = _protocol, voltage = _voltage };
    }

    public object Disconnect()
    {
        _connected = false;
        _liveLogActive = false;
        return new { connected = false };
    }

    public object GetConnectionStatus() =>
        _connected
            ? new { connected = true, adapterId = _adapterId, protocol = _protocol, voltage = _voltage, commFault = false }
            : new { connected = false, adapterId = (string?)null, protocol = (string?)null, voltage = (double?)null, commFault = false };

    public async Task<object> ReadVinAsync()
    {
        RequireConnected();
        var client = new UdsClient(new IsoTpChannel(Log));
        var vin = await client.ReadVinAsync("0x7E0", "0x7E8");
        return new { vin, source = "UDS_22_F190", raw = vin };
    }

    public async Task<object> IdentifyEcusAsync()
    {
        RequireConnected();
        var client = new UdsClient(new IsoTpChannel(Log));
        var addresses = new[] { ("0x7E0", "Gateway (SGW)"), ("0x7E1", "ECM"), ("0x7E2", "TCM"), ("0x7E3", "BCM") };
        var ecus = new List<object>();
        foreach (var (addr, name) in addresses)
        {
            var info = await client.ReadEcuIdentificationAsync(addr, addr.Replace("0x7E", "0x7E8"));
            ecus.Add(new { logicalAddress = addr, name, partNumber = info.PartNumber, softwareVersion = info.SoftwareVersion, calibrationId = info.CalibrationId });
        }
        var securityModules = new[]
        {
            new { type = "gateway", logicalAddress = "0x7E0", partNumber = "unknown", generation = "SGW" },
            new { type = "rf_hub", logicalAddress = "0x7E4", partNumber = "unknown", generation = "unknown" },
        };
        return new { ecus, securityModules, networkTopology = addresses.Select(a => a.Item1).Append("0x7E4").ToArray() };
    }

    public async Task<object> ReadDtcsAsync()
    {
        RequireConnected();
        var client = new UdsClient(new IsoTpChannel(Log));
        var dtcs = await client.ReadDtcsAsync("0x7E0", "0x7E8");
        return new { dtcs };
    }

    public async Task<object> ClearDtcsAsync()
    {
        RequireConnected();
        var client = new UdsClient(new IsoTpChannel(Log));
        await client.ClearDtcsAsync("0x7E0", "0x7E8");
        return new { cleared = true };
    }

    public object StartLiveLog()
    {
        RequireConnected();
        _liveLogActive = true;
        return new { active = true };
    }

    public object StopLiveLog()
    {
        _liveLogActive = false;
        return new { active = false };
    }

    public object PollLiveLog(long since)
    {
        var entries = _commLog.Where(e => e.Timestamp > since).ToList();
        return new { entries };
    }

    public async Task<object> IdentifyVehicleAsync()
    {
        RequireConnected();
        var vinResult = await ReadVinAsync();
        var vin = ((dynamic)vinResult).vin as string ?? "";
        var ecuResult = await IdentifyEcusAsync();
        return new
        {
            sessionId = $"diag-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}",
            vin,
            make = "Dodge",
            modelYear = 2020,
            platform = "unknown",
            ignitionType = "push_button",
            ecus = ((dynamic)ecuResult).ecus,
            securityModules = ((dynamic)ecuResult).securityModules,
            networkTopology = ((dynamic)ecuResult).networkTopology,
            identifiedAt = DateTime.UtcNow.ToString("o"),
            adapterInfo = new { vendor = _adapterId, dll = _adapterId, firmware = "1.0.0" },
        };
    }

    void RequireConnected()
    {
        if (!_connected) throw new InvalidOperationException("Not connected. Select an adapter and connect first.");
    }

    void Log(string direction, string address, string data, string description) =>
        _commLog.Add(new CommLogEntry
        {
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Direction = direction,
            Address = address,
            Data = data,
            Description = description,
        });
}

public sealed class CommLogEntry
{
    public long Timestamp { get; set; }
    public string Direction { get; set; } = "";
    public string Address { get; set; } = "";
    public string Data { get; set; } = "";
    public string Description { get; set; } = "";
}
