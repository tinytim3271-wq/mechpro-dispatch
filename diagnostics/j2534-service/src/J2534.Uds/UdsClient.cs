using MechPro.J2534.IsoTp;

namespace MechPro.J2534.Uds;

public sealed class EcuIdentification
{
    public string PartNumber { get; set; } = "";
    public string SoftwareVersion { get; set; } = "";
    public string CalibrationId { get; set; } = "";
}

/// <summary>UDS diagnostic services for vehicle identification and DTC operations.</summary>
public sealed class UdsClient
{
    readonly IsoTpChannel _channel;

    public UdsClient(IsoTpChannel channel) => _channel = channel;

    public Task<string> ReadVinAsync(string txId, string rxId)
    {
        var response = _channel.SendRequest([0x22, 0xF1, 0x90], txId, rxId);
        ValidatePositive(response, 0x62);
        var vinBytes = response.AsSpan(3);
        return Task.FromResult(System.Text.Encoding.ASCII.GetString(vinBytes).Trim('\0', ' '));
    }

    public async Task<EcuIdentification> ReadEcuIdentificationAsync(string txId, string rxId)
    {
        var part = ReadDataById([0x22, 0xF1, 0x8A], txId, rxId);
        var sw = ReadDataById([0x22, 0xF1, 0x89], txId, rxId);
        var cal = ReadDataById([0x22, 0xF1, 0x8C], txId, rxId);
        return new EcuIdentification
        {
            PartNumber = part,
            SoftwareVersion = sw,
            CalibrationId = cal,
        };
    }

    public Task<object[]> ReadDtcsAsync(string txId, string rxId)
    {
        var response = _channel.SendRequest([0x19, 0x02, 0xFF], txId, rxId);
        ValidatePositive(response, 0x59);
        return Task.FromResult(Array.Empty<object>());
    }

    public Task ClearDtcsAsync(string txId, string rxId)
    {
        var response = _channel.SendRequest([0x14, 0xFF, 0xFF, 0xFF], txId, rxId);
        ValidatePositive(response, 0x54);
        return Task.CompletedTask;
    }

    string ReadDataById(byte[] request, string txId, string rxId)
    {
        var response = _channel.SendRequest(request, txId, rxId);
        ValidatePositive(response, 0x62);
        return System.Text.Encoding.ASCII.GetString(response.AsSpan(3)).Trim('\0', ' ');
    }

    static void ValidatePositive(byte[] response, byte expectedSid)
    {
        if (response.Length < 1 || response[0] != expectedSid)
        {
            var nrc = response.Length >= 3 && response[0] == 0x7F ? response[2] : (byte)0xFF;
            throw new InvalidOperationException($"UDS negative response NRC 0x{nrc:X2}");
        }
    }
}
