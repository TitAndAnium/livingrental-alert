import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Server,
  Activity,
  Database,
  Bell,
  Code,
  Shield,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Rocket,
  FileCode,
  HardDrive,
  Cpu,
  Network,
  Terminal,
  Send,
  Copy,
  Home,
} from "lucide-react";
import type { PreflightResult, DeploymentStatus } from "@shared/schema";

interface StatusResponse {
  deploymentStatus: DeploymentStatus;
  lastPreflightResult: PreflightResult | null;
  secretsConfigured: boolean;
}

function StatusBadge({ running, healthy }: { running: boolean; healthy: boolean }) {
  if (running && healthy) {
    return (
      <Badge variant="default" className="bg-emerald-500 text-white">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        Healthy
      </Badge>
    );
  }
  if (running) {
    return (
      <Badge variant="secondary" className="bg-amber-500 text-white">
        <Activity className="w-3 h-3 mr-1" />
        Running
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="w-3 h-3 mr-1" />
      Offline
    </Badge>
  );
}

function ServiceCard({
  name,
  icon: Icon,
  description,
  status,
  url,
}: {
  name: string;
  icon: typeof Server;
  description: string;
  status?: { running: boolean; healthy: boolean };
  url?: string;
}) {
  return (
    <Card className="hover-elevate">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <CardTitle className="text-base">{name}</CardTitle>
          </div>
          {status && <StatusBadge running={status.running} healthy={status.healthy} />}
        </div>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-sm">{description}</CardDescription>
        {url && (
          <p className="mt-2 text-xs text-muted-foreground font-mono truncate">{url}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [ntfyTopic, setNtfyTopic] = useState("strijps");
  const [ntfyMessage, setNtfyMessage] = useState("Test notification from LivingRental Alert");
  const [deployLogs, setDeployLogs] = useState<string[]>([]);

  const { data: status, isLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/status"],
    refetchInterval: 5000,
  });

  const preflightMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/preflight"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: "Preflight Complete",
        description: "VPS scan completed successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Preflight Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/deploy");
      return response.json() as Promise<{ success: boolean; message: string; logs: string[] }>;
    },
    onSuccess: (data) => {
      setDeployLogs(data.logs || []);
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: data.success ? "Deployment Complete" : "Deployment Failed",
        description: data.message,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Deployment Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const healthCheckMutation = useMutation({
    mutationFn: () => apiRequest("GET", "/api/health-check"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/status"] });
      toast({
        title: "Health Check Complete",
        description: "Service status updated",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Health Check Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const testNtfyMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/test-ntfy", { topic: ntfyTopic, message: ntfyMessage }),
    onSuccess: () => {
      toast({
        title: "Notification Sent",
        description: `Message sent to topic: ${ntfyTopic}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Notification Failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const preflight = status?.lastPreflightResult;
  const deployment = status?.deploymentStatus;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Configuration copied to clipboard",
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary">
                <Home className="w-6 h-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">LivingRental Alert</h1>
                <p className="text-sm text-muted-foreground">VPS Infrastructure Manager</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {status?.secretsConfigured ? (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                  <Shield className="w-3 h-3 mr-1" />
                  Secrets Configured
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="w-3 h-3 mr-1" />
                  Missing Secrets
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Status Banner */}
        {deployment && (
          <Card className="mb-6">
            <CardContent className="py-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {deployment.status === "idle" && <Server className="w-5 h-5 text-muted-foreground" />}
                  {deployment.status === "scanning" && <Loader2 className="w-5 h-5 animate-spin text-primary" />}
                  {deployment.status === "deploying" && <Rocket className="w-5 h-5 animate-pulse text-primary" />}
                  {deployment.status === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                  {deployment.status === "error" && <XCircle className="w-5 h-5 text-destructive" />}
                  <span className="font-medium">{deployment.message}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => preflightMutation.mutate()}
                    disabled={preflightMutation.isPending}
                    data-testid="button-preflight-scan"
                  >
                    {preflightMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Scan VPS
                  </Button>
                  <Button
                    onClick={() => deployMutation.mutate()}
                    disabled={!preflight?.safePlan.readyToDeploy || deployMutation.isPending}
                    data-testid="button-deploy"
                  >
                    {deployMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="w-4 h-4 mr-2" />
                    )}
                    Deploy
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="services" data-testid="tab-services">Services</TabsTrigger>
            <TabsTrigger value="preflight" data-testid="tab-preflight">Preflight</TabsTrigger>
            <TabsTrigger value="config" data-testid="tab-config">Config</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <ServiceCard
                name="PostgreSQL"
                icon={Database}
                description="Internal database for n8n workflows"
                status={deployment?.services?.postgres}
              />
              <ServiceCard
                name="n8n"
                icon={Code}
                description="Workflow automation platform"
                status={deployment?.services?.n8n}
                url={deployment?.services?.n8n?.url}
              />
              <ServiceCard
                name="ntfy"
                icon={Bell}
                description="Push notifications for iPhone & iPad"
                status={deployment?.services?.ntfy}
                url={deployment?.services?.ntfy?.url}
              />
              <ServiceCard
                name="Fetcher"
                icon={Terminal}
                description="Web scraping with Playwright"
                status={deployment?.services?.fetcher}
                url={deployment?.services?.fetcher?.url}
              />
            </div>

            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
                <CardDescription>Test and manage your services</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-3">
                    <Label>Test Push Notification</Label>
                    <div className="flex gap-2">
                      <Input
                        value={ntfyTopic}
                        onChange={(e) => setNtfyTopic(e.target.value)}
                        placeholder="Topic (e.g., strijps)"
                        className="flex-1"
                        data-testid="input-ntfy-topic"
                      />
                      <Button
                        variant="secondary"
                        onClick={() => testNtfyMutation.mutate()}
                        disabled={testNtfyMutation.isPending || !deployment?.services?.ntfy?.running}
                        data-testid="button-test-ntfy"
                      >
                        {testNtfyMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                    <Input
                      value={ntfyMessage}
                      onChange={(e) => setNtfyMessage(e.target.value)}
                      placeholder="Message"
                      data-testid="input-ntfy-message"
                    />
                  </div>
                  <div className="space-y-3">
                    <Label>Service Health</Label>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => healthCheckMutation.mutate()}
                      disabled={healthCheckMutation.isPending || !preflight}
                      data-testid="button-health-check"
                    >
                      {healthCheckMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Activity className="w-4 h-4 mr-2" />
                      )}
                      Check All Services
                    </Button>
                    {preflight && (
                      <p className="text-xs text-muted-foreground">
                        Last scan: {new Date(preflight.timestamp).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Deploy Logs */}
            {deployLogs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Deployment Logs</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-48 w-full rounded-md border p-4">
                    <pre className="text-xs font-mono whitespace-pre-wrap">
                      {deployLogs.join("\n")}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Services Tab */}
          <TabsContent value="services" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* n8n */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Code className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>n8n Workflow Automation</CardTitle>
                      <CardDescription>Create automated rental monitoring workflows</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {deployment?.services?.n8n && (
                      <StatusBadge
                        running={deployment.services.n8n.running}
                        healthy={deployment.services.n8n.healthy}
                      />
                    )}
                  </div>
                  {preflight && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Port</span>
                      <span className="font-mono text-sm">{preflight.safePlan.portsToUse.n8n}</span>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Access via reverse proxy after configuring your domain
                  </p>
                </CardContent>
              </Card>

              {/* ntfy */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Bell className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>ntfy Push Notifications</CardTitle>
                      <CardDescription>Receive alerts on iPhone and iPad</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {deployment?.services?.ntfy && (
                      <StatusBadge
                        running={deployment.services.ntfy.running}
                        healthy={deployment.services.ntfy.healthy}
                      />
                    )}
                  </div>
                  {preflight && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Port</span>
                      <span className="font-mono text-sm">{preflight.safePlan.portsToUse.ntfy}</span>
                    </div>
                  )}
                  <div className="p-3 rounded-md bg-muted">
                    <p className="text-xs font-medium mb-1">Subscribe on iOS:</p>
                    <p className="text-xs text-muted-foreground">
                      ntfy app → Add topic → "strijps"
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Fetcher */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Terminal className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>Fetcher Microservice</CardTitle>
                      <CardDescription>Browser-based web scraping with Playwright</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {deployment?.services?.fetcher && (
                      <StatusBadge
                        running={deployment.services.fetcher.running}
                        healthy={deployment.services.fetcher.healthy}
                      />
                    )}
                  </div>
                  {preflight && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Port</span>
                      <span className="font-mono text-sm">{preflight.safePlan.portsToUse.fetcher}</span>
                    </div>
                  )}
                  <div className="p-3 rounded-md bg-muted">
                    <p className="text-xs font-medium mb-1">Endpoints:</p>
                    <p className="text-xs text-muted-foreground font-mono">/health - Health check</p>
                    <p className="text-xs text-muted-foreground font-mono">/fetch - Fetch URL (POST)</p>
                  </div>
                </CardContent>
              </Card>

              {/* PostgreSQL */}
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-primary/10">
                      <Database className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle>PostgreSQL Database</CardTitle>
                      <CardDescription>Internal database for n8n workflows</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    {deployment?.services?.postgres && (
                      <StatusBadge
                        running={deployment.services.postgres.running}
                        healthy={deployment.services.postgres.healthy}
                      />
                    )}
                  </div>
                  <div className="p-3 rounded-md bg-muted">
                    <p className="text-xs text-muted-foreground">
                      Internal only - not publicly exposed
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Preflight Tab */}
          <TabsContent value="preflight" className="space-y-6">
            {!preflight ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Server className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-2">No Preflight Data</h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Run a preflight scan to analyze your VPS
                  </p>
                  <Button
                    onClick={() => preflightMutation.mutate()}
                    disabled={preflightMutation.isPending}
                    data-testid="button-preflight-empty"
                  >
                    {preflightMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Run Preflight Scan
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* OS Info */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <Cpu className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">System Information</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Hostname</p>
                        <p className="font-mono text-sm">{preflight.osInfo.hostname}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Distribution</p>
                        <p className="font-mono text-sm truncate">{preflight.osInfo.distro}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Kernel</p>
                        <p className="font-mono text-sm">{preflight.osInfo.kernel}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Scanned</p>
                        <p className="font-mono text-sm">{new Date(preflight.timestamp).toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Resources */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <HardDrive className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg">Storage</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Free</span>
                        <span className="font-mono">{preflight.resources.diskFree}</span>
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="text-sm text-muted-foreground">Total</span>
                        <span className="font-mono">{preflight.resources.diskTotal}</span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="flex items-center gap-3">
                        <Activity className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg">Memory</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Free</span>
                        <span className="font-mono">{preflight.resources.memoryFree}</span>
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="text-sm text-muted-foreground">Total</span>
                        <span className="font-mono">{preflight.resources.memoryTotal}</span>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Docker */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Server className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg">Docker</CardTitle>
                      </div>
                      {preflight.docker.installed ? (
                        <Badge className="bg-emerald-500 text-white">Installed</Badge>
                      ) : (
                        <Badge variant="destructive">Not Installed</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {preflight.docker.version && (
                      <p className="text-sm font-mono">{preflight.docker.version}</p>
                    )}
                    {preflight.docker.containers.length > 0 && (
                      <div>
                        <p className="text-sm font-medium mb-2">Running Containers</p>
                        <ScrollArea className="h-32 w-full rounded-md border">
                          <div className="p-3 space-y-2">
                            {preflight.docker.containers.map((c, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="font-mono">{c.name}</span>
                                <span className="text-muted-foreground">{c.status}</span>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Reverse Proxy */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Network className="w-5 h-5 text-primary" />
                        <CardTitle className="text-lg">Reverse Proxy</CardTitle>
                      </div>
                      {preflight.reverseProxy.detected ? (
                        <Badge className="bg-emerald-500 text-white capitalize">
                          {preflight.reverseProxy.type}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">None Detected</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {preflight.reverseProxy.configPath && (
                      <p className="text-sm font-mono text-muted-foreground">
                        Config: {preflight.reverseProxy.configPath}
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Warnings */}
                {preflight.safePlan.warnings.length > 0 && (
                  <Card className="border-amber-500/50">
                    <CardHeader>
                      <CardTitle className="text-lg text-amber-600">Warnings</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-2">
                        {preflight.safePlan.warnings.map((w, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <span className="text-amber-500 mt-0.5">•</span>
                            {w}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {/* Planned Ports */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Deployment Plan</CardTitle>
                    <CardDescription>Ports allocated for services</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-2 md:grid-cols-4">
                      <div className="p-3 rounded-md bg-muted">
                        <p className="text-xs text-muted-foreground">PostgreSQL</p>
                        <p className="font-mono">{preflight.safePlan.portsToUse.postgres}</p>
                      </div>
                      <div className="p-3 rounded-md bg-muted">
                        <p className="text-xs text-muted-foreground">n8n</p>
                        <p className="font-mono">{preflight.safePlan.portsToUse.n8n}</p>
                      </div>
                      <div className="p-3 rounded-md bg-muted">
                        <p className="text-xs text-muted-foreground">ntfy</p>
                        <p className="font-mono">{preflight.safePlan.portsToUse.ntfy}</p>
                      </div>
                      <div className="p-3 rounded-md bg-muted">
                        <p className="text-xs text-muted-foreground">Fetcher</p>
                        <p className="font-mono">{preflight.safePlan.portsToUse.fetcher}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Config Tab */}
          <TabsContent value="config" className="space-y-6">
            {preflight?.safePlan.proxyConfigSnippet ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <FileCode className="w-5 h-5 text-primary" />
                      <div>
                        <CardTitle className="text-lg">Reverse Proxy Configuration</CardTitle>
                        <CardDescription>
                          Add this to your {preflight.reverseProxy.type} configuration
                        </CardDescription>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(preflight.safePlan.proxyConfigSnippet!)}
                      data-testid="button-copy-config"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-80 w-full rounded-md border">
                    <pre className="p-4 text-xs font-mono whitespace-pre">
                      {preflight.safePlan.proxyConfigSnippet}
                    </pre>
                  </ScrollArea>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileCode className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="font-medium mb-2">No Configuration Available</h3>
                  <p className="text-sm text-muted-foreground">
                    Run a preflight scan to generate proxy configuration
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Phase Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Phase 1 Complete</CardTitle>
                <CardDescription>VPS infrastructure foundation</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>PostgreSQL database for n8n</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>n8n workflow automation</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>ntfy push notifications</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Playwright fetcher microservice</span>
                  </div>
                </div>
                <div className="pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Future phases will add n8n workflows, source adapters, and optional login support.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
