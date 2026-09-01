using System.Text.Json;
using System.Text.Json.Serialization;

namespace MechPro.J2534.Host;

public static class JsonOptions
{
    public static readonly JsonSerializerOptions Rpc = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DictionaryKeyPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
}
