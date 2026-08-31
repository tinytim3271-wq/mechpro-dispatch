using System.Runtime.InteropServices;
using MechPro.J2534.Native;

namespace MechPro.J2534.Core;

/// <summary>Enumerates registered J2534 Pass-Thru devices from the Windows registry.</summary>
public static class AdapterRegistry
{
    public static object ListAdapters()
    {
        var adapters = new List<AdapterInfo>();

        if (OperatingSystem.IsWindows())
        {
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\PassThruSupport.04.04");
                if (key is not null)
                {
                    foreach (var name in key.GetSubKeyNames())
                    {
                        using var sub = key.OpenSubKey(name);
                        var dll = sub?.GetValue("FunctionLibrary") as string;
                        adapters.Add(new AdapterInfo
                        {
                            Id = $"registry-{name}",
                            Name = name,
                            Vendor = name.Split(' ')[0],
                            DllPath = dll ?? "(unknown)",
                            Protocols = ["CAN", "ISO15765"],
                            Firmware = "unknown",
                        });
                    }
                }
            }
            catch
            {
                // Registry access may fail in restricted environments
            }
        }

        return new { adapters, simulator = adapters.Count == 0 };
    }
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
