using MechPro.J2534.IsoTp;
using MechPro.J2534.Native;
using MechPro.J2534.Uds;

namespace MechPro.J2534.Core;

/// <summary>Manages a single J2534 diagnostic session with ISO-TP and UDS services.</summary>
public sealed class DiagnosticSession : IDisposable
{
    readonly List<CommLogEntry> _commLog = [];
    PassThruDevice? _device;
    bool _connected;
    bool _simulator;
    string? _adapterId;
    string? _adapterName;
    string? _dllPath;
    string? _protocol;
    double _voltage;
    bool _liveLogActive;
    bool _disposed;

    public bool IsSimulator => _simulator;

    public object Connect(ConnectParams p)
    {
        DisconnectInternal();

        _adapterId = p.AdapterId ?? "simulator";
        _protocol = p.Protocol ?? "ISO15765";
        _simulator = _adapterId == "simulator" || !OperatingSystem.IsWindows();

        if (_simulator)
        {
            _connected = true;
            _adapterName = "MechPro CAN Simulator";
            _dllPath = "builtin-simulator";
            _voltage = 12.6;
            Log("tx", "0x7E0", "1003", "Diagnostic session start (simulator)");
            Log("rx", "0x7E8", "5003", "Positive response (simulator)");
            return new { connected = true, protocol = _protocol, voltage = _voltage, simulator = true };
        }

        var adapter = AdapterRegistry.Resolve(_adapterId)
            ?? throw new InvalidOperationException($"Unknown adapter: {_adapterId}");

        if (string.IsNullOrWhiteSpace(adapter.DllPath) || !File.Exists(adapter.DllPath))
            throw new InvalidOperationException($"J2534 DLL not found for adapter '{adapter.Name}'. Install the vendor driver.");

        _device = PassThruDevice.Open(adapter.DllPath, adapter.Name);
        _device.Connect(PassThruApi.PROTOCOL_ISO15765, (uint)(p.BaudRate ?? 500_000));
        _adapterName = adapter.Name;
        _dllPath = adapter.DllPath;
        _voltage = _device.ReadVoltage();
        if (_voltage <= 0) _voltage = 12.0;
        _connected = true;

        var channel = CreateChannel();
        var client = new UdsClient(channel);
        try
        {
            _ = client.SendTesterPresent("0x7E0", "0x7E8");
            Log("tx", "0x7E0", "3E00", "Tester present");
        }
        catch
        {
            // Vehicle may not respond until ignition is on — connection still valid.
        }

        return new { connected = true, protocol = _protocol, voltage = _voltage, simulator = false };
    }

    public object Disconnect()
    {
        DisconnectInternal();
        return new { connected = false };
    }

    void DisconnectInternal()
    {
        _connected = false;
        _liveLogActive = false;
        _device?.Dispose();
        _device = null;
    }

    public object GetConnectionStatus() =>
        _connected
            ? new
            {
                connected = true,
                adapterId = _adapterId,
                protocol = _protocol,
                voltage = _voltage,
                commFault = false,
                simulator = _simulator,
                adapterName = _adapterName,
                dllPath = _dllPath,
            }
            : new
            {
                connected = false,
                adapterId = (string?)null,
                protocol = (string?)null,
                voltage = (double?)null,
                commFault = false,
                simulator = false,
                adapterName = (string?)null,
                dllPath = (string?)null,
            };

    public async Task<object> ReadVinAsync()
    {
        RequireConnected();
        var client = new UdsClient(CreateChannel());
        var vin = await client.ReadVinAsync("0x7E0", "0x7E8");
        return new { vin, source = "UDS_22_F190", raw = vin };
    }

    public async Task<object> IdentifyEcusAsync()
    {
        RequireConnected();
        var client = new UdsClient(CreateChannel());
        var addresses = new[] { ("0x7E0", "Gateway (SGW)"), ("0x7E1", "ECM"), ("0x7E2", "TCM"), ("0x7E3", "BCM") };
        var ecus = new List<object>();
        foreach (var (addr, name) in addresses)
        {
            try
            {
                var info = await client.ReadEcuIdentificationAsync(addr, addr.Replace("0x7E", "0x7E8"));
                ecus.Add(new { logicalAddress = addr, name, partNumber = info.PartNumber, softwareVersion = info.SoftwareVersion, calibrationId = info.CalibrationId });
            }
            catch (Exception ex)
            {
                ecus.Add(new { logicalAddress = addr, name, partNumber = "unavailable", softwareVersion = ex.Message, calibrationId = "" });
            }
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
        var client = new UdsClient(CreateChannel());
        var dtcs = await client.ReadDtcsAsync("0x7E0", "0x7E8");
        return new { dtcs };
    }

    public async Task<object> ClearDtcsAsync()
    {
        RequireConnected();
        var client = new UdsClient(CreateChannel());
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
        if (_liveLogActive && _connected && !_simulator && _device is not null)
        {
            try
            {
                _voltage = _device.ReadVoltage();
            }
            catch { /* ignore voltage poll errors */ }
        }
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
            make = InferMake(vin),
            modelYear = InferModelYear(vin),
            platform = "unknown",
            ignitionType = "push_button",
            ecus = ((dynamic)ecuResult).ecus,
            securityModules = ((dynamic)ecuResult).securityModules,
            networkTopology = ((dynamic)ecuResult).networkTopology,
            identifiedAt = DateTime.UtcNow.ToString("o"),
            adapterInfo = new
            {
                vendor = _simulator ? "MechPro" : _adapterName,
                dll = _dllPath,
                firmware = _simulator ? "1.0.0-sim" : "J2534",
            },
            simulator = _simulator,
        };
    }

    IIsoTpChannel CreateChannel() =>
        _simulator || _device is null
            ? new SimulatedIsoTpChannel(Log)
            : new J2534IsoTpChannel(_device, Log);

    static string InferMake(string vin)
    {
        if (vin.Length < 3) return "Unknown";
        var wmi = vin[..3].ToUpperInvariant();
        return wmi is "1C6" or "3C6" ? "Ram" : wmi is "1D7" or "1B3" ? "Dodge" : "Stellantis";
    }

    static int InferModelYear(string vin)
    {
        if (vin.Length < 10) return 0;
        var code = vin[9];
        if (code is >= 'A' and <= 'Z') return 2010 + (code - 'A');
        if (code is >= '0' and <= '9') return 2000 + (code - '0');
        return 0;
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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DisconnectInternal();
    }
}

public sealed class CommLogEntry
{
    public long Timestamp { get; set; }
    public string Direction { get; set; } = "";
    public string Address { get; set; } = "";
    public string Data { get; set; } = "";
    public string Description { get; set; } = "";
}
