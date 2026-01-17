"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT_RPC = "https://polygon-rpc.com";

export default function SettingsPage() {
  const [rpcUrl, setRpcUrl] = useState("");
  const [ratePreference, setRatePreference] = useState("apr");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const storedRpc = localStorage.getItem("polygonRpcUrl") ?? "";
    const storedPref = localStorage.getItem("ratePreference") ?? "apr";
    setRpcUrl(storedRpc);
    setRatePreference(storedPref);
  }, []);

  const onSave = () => {
    localStorage.setItem("polygonRpcUrl", rpcUrl);
    localStorage.setItem("ratePreference", ratePreference);
    setStatus("Preferências guardadas.");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Personaliza o RPC e as preferências de visualização.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>RPC Polygon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rpc-url">RPC URL</Label>
            <Input
              id="rpc-url"
              placeholder={DEFAULT_RPC}
              value={rpcUrl}
              onChange={(event) => setRpcUrl(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Deixar vazio para usar o default público.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferências</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Mostrar taxas como</Label>
            <Select value={ratePreference} onValueChange={setRatePreference}>
              <SelectTrigger>
                <SelectValue placeholder="Seleciona" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apr">APR</SelectItem>
                <SelectItem value="apy">APY</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Button onClick={onSave}>Guardar settings</Button>
      {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
    </div>
  );
}
