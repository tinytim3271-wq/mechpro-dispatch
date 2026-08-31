using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using MechPro.J2534.Core;

namespace MechPro.J2534.Host;

/// <summary>Named-pipe JSON-RPC host for J2534 diagnostic operations.</summary>
public static class Program
{
    public const string PipeName = "mechpro-j2534";

    public static async Task Main(string[] args)
    {
        var session = new DiagnosticSession();
        Console.WriteLine($"J2534.Host starting on \\\\.\\pipe\\{PipeName}");

        while (true)
        {
            await using var pipe = new NamedPipeServerStream(
                PipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            await pipe.WaitForConnectionAsync();
            try
            {
                await HandleClientAsync(pipe, session);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Client error: {ex.Message}");
            }
        }
    }

    static async Task HandleClientAsync(Stream stream, DiagnosticSession session)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
        await using var writer = new StreamWriter(stream, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };

        while (stream.CanRead)
        {
            var line = await reader.ReadLineAsync();
            if (line is null) break;

            JsonRpcResponse response;
            try
            {
                var request = JsonSerializer.Deserialize<JsonRpcRequest>(line);
                if (request is null)
                {
                    response = JsonRpcResponse.Error(null, -32700, "Parse error");
                }
                else
                {
                    response = await RpcDispatcher.DispatchAsync(request, session);
                }
            }
            catch (Exception ex)
            {
                response = JsonRpcResponse.Error(null, -32000, ex.Message);
            }

            await writer.WriteLineAsync(JsonSerializer.Serialize(response));
        }
    }
}
