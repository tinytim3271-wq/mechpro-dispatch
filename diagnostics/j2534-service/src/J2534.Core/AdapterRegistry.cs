using Microsoft.Win32;

namespace MechPro.J2534.Core;

/// <summary>Enumerates registered J2534 Pass-Thru devices from the Windows registry.</summary>
public static class AdapterRegistry
{
    const string SimulatorId = "simulator";

    static readonly string[] RegistryRoots =
    [
        @"SOFTWARE\PassThruSupport.04.04",
        @"SOFTWARE\WOW6432Node\PassThruSupport.04.04",
        @"SOFTWARE\PassThruSupport.04.02",
        @"SOFTWARE\WOW6432Node\PassThruSupport.04.02",
    ];

    static readonly string[] Registry32Roots =
    [
        @"SOFTWARE\PassThruSupport.04.04",
        @"SOFTWARE\PassThruSupport.04.02",
    ];

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

        var seenDlls = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (root, key) in OpenRegistryRoots())
        {
            try
            {
                foreach (var entry in ReadAdaptersFromKey(key, root))
                {
                    if (!seenDlls.Add(entry.DllPath)) continue;
                    adapters.Add(entry);
                }
            }
            catch
            {
                // Registry access may fail in restricted environments.
            }
            finally
            {
                key.Dispose();
            }
        }

        return adapters;
    }

    static IEnumerable<(string Root, RegistryKey Key)> OpenRegistryRoots()
    {
        var roots = new List<(string Root, RegistryKey Key)>();

        foreach (var root in RegistryRoots)
        {
            RegistryKey? key = null;
            try
            {
                key = Registry.LocalMachine.OpenSubKey(root);
                if (key is not null) roots.Add((root, key));
                else key = null;
            }
            catch
            {
                key?.Dispose();
            }
        }

        try
        {
            using var base32 = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry32);
            foreach (var root in Registry32Roots)
            {
                RegistryKey? key = null;
                try
                {
                    key = base32.OpenSubKey(root);
                    if (key is not null) roots.Add(($"registry32:{root}", key));
                    else key = null;
                }
                catch
                {
                    key?.Dispose();
                }
            }
        }
        catch
        {
            // Ignore 32-bit hive access failures.
        }

        return roots;
    }

    static IEnumerable<AdapterInfo> ReadAdaptersFromKey(RegistryKey key, string root)
    {
        foreach (var subKeyName in key.GetSubKeyNames())
        {
            using var sub = key.OpenSubKey(subKeyName);
            var dll = ReadRegistryString(sub, "FunctionLibrary");
            if (string.IsNullOrWhiteSpace(dll)) continue;
            dll = Environment.ExpandEnvironmentVariables(dll);

            var displayName = ReadRegistryString(sub, "Name");
            if (string.IsNullOrWhiteSpace(displayName)) displayName = subKeyName;

            var vendor = ReadRegistryString(sub, "Vendor");
            if (string.IsNullOrWhiteSpace(vendor))
                vendor = displayName.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? displayName;

            yield return new AdapterInfo
            {
                Id = BuildAdapterId(root, subKeyName, dll),
                Name = displayName,
                Vendor = vendor,
                DllPath = dll,
                Protocols = ReadProtocols(sub),
                Firmware = ReadRegistryString(sub, "Firmware") ?? "unknown",
            };
        }
    }

    static string? ReadRegistryString(RegistryKey? key, string name)
    {
        if (key is null) return null;
        var value = key.GetValue(name);
        return value switch
        {
            string s => s.Trim(),
            string[] arr when arr.Length > 0 => arr[0].Trim(),
            _ => null,
        };
    }

    static string[] ReadProtocols(RegistryKey? sub)
    {
        if (sub is null) return ["CAN", "ISO15765"];
        var protocols = new List<string>();
        if (ReadFlag(sub, "CAN")) protocols.Add("CAN");
        if (ReadFlag(sub, "ISO15765")) protocols.Add("ISO15765");
        if (ReadFlag(sub, "ISO15765_FD")) protocols.Add("ISO15765_FD");
        if (ReadFlag(sub, "ISO9141")) protocols.Add("ISO9141");
        if (ReadFlag(sub, "ISO14230")) protocols.Add("ISO14230");
        return protocols.Count > 0 ? protocols.ToArray() : ["CAN", "ISO15765"];
    }

    static bool ReadFlag(RegistryKey sub, string name)
    {
        var value = sub.GetValue(name);
        return value switch
        {
            int i => i != 0,
            long l => l != 0,
            string s => s is "1" or "true" or "TRUE",
            _ => false,
        };
    }

    static string BuildAdapterId(string root, string subKeyName, string dllPath)
    {
        var scope = root.Contains("WOW6432Node", StringComparison.OrdinalIgnoreCase) || root.StartsWith("registry32:", StringComparison.Ordinal)
            ? "wow64"
            : "native";
        var version = root.Contains("04.02", StringComparison.Ordinal) ? "0402" : "0404";
        var slug = subKeyName.Replace(' ', '-').ToLowerInvariant();
        return $"registry-{scope}-{version}-{slug}";
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
