using Microsoft.Win32;

namespace MechPro.J2534.Core;

/// <summary>Enumerates registered J2534 Pass-Thru devices from the Windows registry.</summary>
public static class AdapterRegistry
{
    const string SimulatorId = "simulator";

    public static object ListAdapters()
    {
        var adapters = EnumerateHardwareAdapters();
        adapters.Add(CreateSimulatorAdapter());
        return new { adapters, simulator = adapters.Count == 1 };
    }

    public static AdapterInfo? Resolve(string adapterId)
    {
        if (string.IsNullOrWhiteSpace(adapterId) || adapterId == SimulatorId)
            return CreateSimulatorAdapter();

        return EnumerateHardwareAdapters().FirstOrDefault(a => a.Id == adapterId);
    }

    static List<AdapterInfo> EnumerateHardwareAdapters()
    {
        var adapters = new List<AdapterInfo>();
        if (!OperatingSystem.IsWindows()) return adapters;

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\PassThruSupport.04.04");
            if (key is null) return adapters;

            foreach (var name in key.GetSubKeyNames())
            {
                using var sub = key.OpenSubKey(name);
                var dll = sub?.GetValue("FunctionLibrary") as string;
                if (string.IsNullOrWhiteSpace(dll)) continue;
                adapters.Add(new AdapterInfo
                {
                    Id = $"registry-{name}",
                    Name = name,
                    Vendor = name.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? name,
                    DllPath = dll,
                    Protocols = ["CAN", "ISO15765", "ISO15765_FD"],
                    Firmware = "unknown",
                });
            }
        }
        catch
        {
            // Registry access may fail in restricted environments.
        }

        return adapters;
    }

    static AdapterInfo CreateSimulatorAdapter() => new()
    {
        Id = SimulatorId,
        Name = "MechPro CAN Simulator (Dodge/Ram bench)",
        Vendor = "MechPro",
        DllPath = "builtin-simulator",
        Protocols = ["CAN", "ISO15765"],
        Firmware = "1.0.0-sim",
    };
}

public sealed class AdapterInfo
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Vendor { get; set; } = "";
    public string DllPath { get; set; } = "";
    public string[] Protocols { get; set; } = [];
    public string Firmware { get; set; } = "";
}
