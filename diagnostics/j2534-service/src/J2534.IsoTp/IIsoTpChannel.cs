namespace MechPro.J2534.IsoTp;

public interface IIsoTpChannel
{
    byte[] SendRequest(byte[] request, string txId, string rxId);
}
