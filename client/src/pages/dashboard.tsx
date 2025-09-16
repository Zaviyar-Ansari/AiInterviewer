import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import ProgressChart from "@/components/ProgressChart";
import { Link, useLocation } from "wouter";
import { supabase } from "@/lib/supabaseClient";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  PlayCircle,
  Calendar,
  Clock,
  Eye,
  Target,
  Video,
  RefreshCw,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Brain,
  Trash2,
} from "lucide-react";

interface DashboardProps {
  user: any;
}

export default function Dashboard({ user }: DashboardProps) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [openVideoUrl, setOpenVideoUrl] = useState<string | null>(null);

  // 📊 Fetch sessions using email fallback, in case local user_id mapping differs
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    refetch,
  } = useQuery<any[]>({
    queryKey: ["/api/sessions", user?.id, user?.email],
    enabled: !!user?.email || !!user?.id,
    retry: false,
    refetchInterval: (query) => {
      // Refetch every 5 seconds if any session is still processing
      const data = query.state.data;
      const hasProcessing =
        Array.isArray(data) &&
        data.some((session) => session.status === "processing");
      return hasProcessing ? 5000 : false;
    },
    queryFn: async () => {
      try {
        const base = `${
          (import.meta as any).env?.VITE_API_URL || "http://localhost:5000"
        }`;
        const apiUrl = `${base}/api/candidate/sessions`;
        const token = localStorage.getItem("supabase_token");

        const res = await fetch(apiUrl, {
          headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }

        const json = await res.json();

        // Return all sessions - we'll show conversion status for each
        return json || [];
      } catch (error) {
        toast({
          title: "Error fetching sessions",
          description:
            "Failed to load your interview sessions. Please try again.",
          variant: "destructive",
        });
        return [];
      }
    },
  });

  // 📊 Fetch conversion status
  const { data: conversionsData } = useQuery<any[]>({
    queryKey: ["/api/conversions", user?.email],
    enabled: !!user?.email,
    retry: false,
    refetchInterval: 5000, // Refetch every 5 seconds to check conversion status
    queryFn: async () => {
      try {
        const base = `${
          (import.meta as any).env?.VITE_API_URL || "http://localhost:5000"
        }`;
        const apiUrl = `${base}/api/candidate/conversions`;
        const token = localStorage.getItem("supabase_token");

        const res = await fetch(apiUrl, {
          headers: {
            ...(token && { Authorization: `Bearer ${token}` }),
          },
        });

        if (!res.ok) {
          return [];
        }

        const json = await res.json();
        return json || [];
      } catch (error) {
        console.error("Error fetching conversions:", error);
        return [];
      }
    },
  });

  const { data: feedbackData } = useQuery<any>({
    queryKey: ["/api/sessions/feedback/all"],
    enabled: !!user,
    retry: false,
    queryFn: async () => ({}),
  });

  // 🚀 Logout
  async function handleLogout() {
    await supabase.auth.signOut();
    toast({
      title: "Logged out",
      description: "You have been logged out successfully.",
    });
    navigate("/auth");
  }

  // 🗑️ Delete session
  async function handleDeleteSession(sessionId: string) {
    if (
      !confirm(
        "Are you sure you want to delete this interview session? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      const base = `${
        (import.meta as any).env?.VITE_API_URL || "http://localhost:5000"
      }`;
      const apiUrl = `${base}/api/candidate/session/${sessionId}`;
      const token = localStorage.getItem("supabase_token");

      const response = await fetch(apiUrl, {
        method: "DELETE",
        headers: {
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      toast({
        title: "Session deleted",
        description: "The interview session has been successfully deleted.",
      });

      // Refresh the sessions list
      refetch();
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Failed to delete the session. Please try again.",
        variant: "destructive",
      });
    }
  }

  // 🧪 Test video URL accessibility
  async function testVideoUrl(url: string) {
    try {
      console.log("Testing video URL:", url);
      const response = await fetch(url, { method: "HEAD" });
      console.log(
        "Video URL test response:",
        response.status,
        response.headers.get("content-type")
      );
      return response.ok;
    } catch (error) {
      console.error("Video URL test failed:", error);
      return false;
    }
  }

  // 🔒 Authentication is now handled by withAuth HOC wrapper
  // No need for duplicate redirect logic here

  const conversions = conversionsData ?? []; // ✅ always an array

  // Helper function to get conversion status for a session
  const getConversionStatus = (session: any) => {
    if (!session?.video_url) return null;

    // Extract filename from video URL - look for raw folder files
    const urlParts = session.video_url.split("/");
    
    // Check if this is a raw folder video URL (needs conversion)
    if (session.video_url.includes('/raw/')) {
      // Extract the filename from the raw folder URL
      const fileName = urlParts.slice(-3).join('/'); // raw/{email}/{filename}
      const conversion = conversions.find((c: any) => c.filename === fileName);
      return conversion;
    }

    // If it's already in converted folder, no conversion needed
    if (session.video_url.includes('/converted/')) {
      return { status: 'completed', converted_url: session.video_url };
    }

    return null;
  };

  const sessions = sessionsData ?? []; // ✅ always an array

  // 🔢 Stats
  const completedSessions = sessions.filter(
    (s: any) => s?.status === "completed" || s?.status === "uploaded"
  );

  const averageScore =
    completedSessions.length > 0
      ? completedSessions.reduce(
          (acc: number, session: any) => acc + (session?.overallScore || 8.2),
          0
        ) / completedSessions.length
      : 0;

  const thisWeekSessions = sessions.filter((s: any) => {
    if (!s?.created_at) return false;
    const sessionDate = new Date(s.created_at);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return sessionDate > weekAgo;
  });

  const getStatusBadge = (session: any) => {
    const conversion = getConversionStatus(session);

    // If there's a conversion in progress, show conversion status
    if (conversion) {
      switch (conversion.status) {
        case "pending":
          return (
            <Badge variant="outline" className="bg-gray-100 text-gray-800">
              Queued
            </Badge>
          );
        case "converting":
          return (
            <Badge
              variant="outline"
              className="bg-blue-100 text-blue-800 animate-pulse"
            >
              Converting...
            </Badge>
          );
        case "completed":
          return (
            <Badge variant="default" className="bg-green-100 text-green-800">
              Converted
            </Badge>
          );
        case "failed":
          return (
            <Badge variant="destructive" className="bg-red-100 text-red-800">
              Failed
            </Badge>
          );
        default:
          return <Badge variant="outline">{conversion.status}</Badge>;
      }
    }

    // Fallback to session status
    switch (session?.status) {
      case "uploaded":
        return (
          <Badge variant="default" className="bg-green-100 text-green-800">
            Completed
          </Badge>
        );
      case "created":
        return (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            In Progress
          </Badge>
        );
      case "processing":
        return (
          <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
            Processing
          </Badge>
        );
      default:
        return <Badge variant="outline">{session?.status || "Unknown"}</Badge>;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "uploaded":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "created":
        return <Clock className="h-4 w-4 text-blue-600" />;
      case "processing":
        return <RefreshCw className="h-4 w-4 text-yellow-600 animate-spin" />;
      default:
        return <AlertCircle className="h-4 w-4 text-gray-600" />;
    }
  };

  if (sessionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 🔝 Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" data-testid="button-back">
                  ← Back
                </Button>
              </Link>
              <h1 className="text-2xl font-bold text-neutral">
                Interview Dashboard
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">
                    {user?.email?.[0]?.toUpperCase() ?? "U"}
                  </span>
                </div>
                <span className="text-gray-700">{user?.email}</span>
              </div>
              <Link href="/interview">
                <Button
                  className="bg-primary hover:bg-blue-800"
                  data-testid="button-new-interview"
                >
                  <PlayCircle className="h-4 w-4 mr-2" />
                  New Interview
                </Button>
              </Link>
              {/* 🚀 Logout button */}
              <Button
                variant="outline"
                onClick={handleLogout}
                data-testid="button-logout"
              >
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* 📊 Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* ✅ Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200 hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-blue-900">Total Sessions</CardTitle>
              <Calendar className="h-5 w-5 text-blue-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-blue-900">
                {sessions.length}
              </p>
              <p className="text-sm text-blue-700">
                {thisWeekSessions.length} this week
              </p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200 hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-green-900">Completed</CardTitle>
              <CheckCircle className="h-5 w-5 text-green-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-900">
                {completedSessions.length}
              </p>
              <p className="text-sm text-green-700">interviews done</p>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200 hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-purple-900">Average Score</CardTitle>
              <Target className="h-5 w-5 text-purple-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-purple-900">
                {averageScore.toFixed(1)}/10
              </p>
              <Progress value={(averageScore / 10) * 100} className="mt-2" />
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200 hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-orange-900">In Progress</CardTitle>
              <Clock className="h-5 w-5 text-orange-600" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-orange-900">
                {
                  sessions.filter(
                    (s) => s?.status === "created" || s?.status === "processing"
                  ).length
                }
              </p>
              <p className="text-sm text-orange-700">sessions active</p>
            </CardContent>
          </Card>
        </div>

        {/* ✅ Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Performance Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressChart sessions={completedSessions} />
          </CardContent>
        </Card>

        {/* ✅ Interview Sessions Grid */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Your Interview Sessions</CardTitle>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <div className="text-center py-12">
                <Video className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">
                  No interviews yet
                </h3>
                <p className="text-gray-500 mb-6">
                  Start your first interview to see your progress here.
                </p>
                <Link href="/interview">
                  <Button className="bg-primary hover:bg-blue-800">
                    <PlayCircle className="h-4 w-4 mr-2" />
                    Start Your First Interview
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {sessions.map((session: any) => (
                  <Card
                    key={session?.id}
                    className={`group hover:shadow-xl transition-all duration-300 border-0 shadow-md hover:scale-[1.02] bg-gradient-to-br from-white to-gray-50 ${
                      session?.video_url ? "cursor-pointer" : ""
                    }`}
                    onClick={() => {
                      const conversion = getConversionStatus(session);
                      let videoUrl = session?.video_url;
                      
                      // Use converted URL if available
                      if (conversion?.converted_url) {
                        videoUrl = conversion.converted_url;
                      }
                      
                      if (videoUrl) {
                        console.log("Opening video:", videoUrl);
                        setOpenVideoUrl(videoUrl);
                      } else {
                        console.log(
                          "No video URL available for session:",
                          session.id
                        );
                        toast({
                          title: "No Video Available",
                          description:
                            "This session doesn't have a recorded video.",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    <CardHeader className="pb-3 bg-gradient-to-r from-gray-50 to-gray-100 rounded-t-lg">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          {getStatusIcon(session?.status)}
                          <span className="text-sm font-semibold text-gray-800">
                            Interview #{String(session?.id)?.slice(0, 8)}...
                          </span>
                        </div>
                        <div className="flex items-center space-x-2">
                          {getStatusBadge(session)}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 hover:bg-red-50"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Video preview */}
                      <div className="relative rounded-md overflow-hidden bg-gray-100 aspect-video">
                        {session?.video_url ? (
                          <>
                            <video
                              src={(() => {
                                const conversion = getConversionStatus(session);
                                return conversion?.converted_url || session.video_url;
                              })()}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              onError={(e) => {
                                console.error("Video preview load error:", e);
                                console.error("Video URL:", session.video_url);
                                const videoElement =
                                  e.target as HTMLVideoElement;
                                console.error(
                                  "Video element error details:",
                                  videoElement?.error
                                );
                                console.error(
                                  "Video element network state:",
                                  videoElement?.networkState
                                );
                                console.error(
                                  "Video element ready state:",
                                  videoElement?.readyState
                                );

                                // Try to fetch the video URL to check if it's accessible
                                fetch(session.video_url, { method: "HEAD" })
                                  .then((response) => {
                                    console.log(
                                      "Video URL fetch response:",
                                      response.status,
                                      response.headers.get("content-type")
                                    );
                                    if (!response.ok) {
                                      console.error(
                                        "Video URL is not accessible:",
                                        response.status
                                      );
                                    }
                                  })
                                  .catch((fetchError) => {
                                    console.error(
                                      "Failed to fetch video URL:",
                                      fetchError
                                    );
                                  });

                                toast({
                                  title: "Video Preview Error",
                                  description:
                                    "Unable to load video preview. The video may be corrupted or inaccessible.",
                                  variant: "destructive",
                                });
                              }}
                              onLoadedData={() => {
                                console.log(
                                  "Video preview loaded successfully for session:",
                                  session.id
                                );
                                console.log("Video URL:", session.video_url);
                              }}
                              onLoadStart={() => {
                                console.log(
                                  "Video load started for URL:",
                                  session.video_url
                                );
                              }}
                              onCanPlay={() => {
                                console.log(
                                  "Video can play for URL:",
                                  session.video_url
                                );
                              }}
                            />
                            <div className="absolute inset-0 bg-black/20" />
                            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                              <div className="w-12 h-12 rounded-full bg-white/80 backdrop-blur flex items-center justify-center shadow">
                                <PlayCircle className="h-6 w-6 text-gray-800" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Video className="h-10 w-10 text-gray-400" />
                          </div>
                        )}
                      </div>

                      <div className="space-y-3 text-sm">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-gray-50 rounded-lg p-2">
                            <span className="text-gray-500 text-xs block">
                              Date
                            </span>
                            <span className="text-gray-900 font-medium">
                              {session?.created_at
                                ? new Date(
                                    session.created_at
                                  ).toLocaleDateString()
                                : "Unknown"}
                            </span>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2">
                            <span className="text-gray-500 text-xs block">
                              Time
                            </span>
                            <span className="text-gray-900 font-medium">
                              {session?.created_at
                                ? new Date(
                                    session.created_at
                                  ).toLocaleTimeString()
                                : "Unknown"}
                            </span>
                          </div>
                        </div>
                        {(() => {
                          const conversion = getConversionStatus(session);
                          if (conversion) {
                            switch (conversion.status) {
                              case "pending":
                                return (
                                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
                                    <div className="flex items-center justify-center space-x-2">
                                      <Clock className="h-4 w-4 text-gray-600" />
                                      <span className="text-gray-700 text-sm font-medium">
                                        Queued for conversion
                                      </span>
                                    </div>
                                  </div>
                                );
                              case "converting":
                                return (
                                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
                                    <div className="flex items-center justify-center space-x-2">
                                      <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
                                      <span className="text-blue-700 text-sm font-medium">
                                        Converting video...
                                      </span>
                                    </div>
                                  </div>
                                );
                              case "completed":
                                return (
                                  <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                                    <div className="flex items-center justify-center space-x-2">
                                      <CheckCircle className="h-4 w-4 text-green-600" />
                                      <span className="text-green-700 text-sm font-medium">
                                        Video Ready
                                      </span>
                                    </div>
                                  </div>
                                );
                              case "failed":
                                return (
                                  <div className="bg-red-50 border border-red-200 rounded-lg p-2">
                                    <div className="flex items-center justify-center space-x-2">
                                      <AlertCircle className="h-4 w-4 text-red-600" />
                                      <span className="text-red-700 text-sm font-medium">
                                        Conversion Failed
                                      </span>
                                    </div>
                                  </div>
                                );
                            }
                          } else if (session?.video_url) {
                            return (
                              <div className="bg-green-50 border border-green-200 rounded-lg p-2">
                                <div className="flex items-center justify-center space-x-2">
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                  <span className="text-green-700 text-sm font-medium">
                                    Video Available
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>

                      <div className="flex space-x-2 pt-3">
                        {(() => {
                          const conversion = getConversionStatus(session);
                          return (
                            conversion?.status === "completed" ||
                            (!conversion && session?.status === "uploaded")
                          );
                        })() && (
                          <div className="flex space-x-2 flex-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex-1 bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100 hover:border-blue-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                const conversion = getConversionStatus(session);
                                const videoUrl = conversion?.converted_url || session?.video_url;
                                
                                if (videoUrl) {
                                  console.log(
                                    "Watch Video button clicked, URL:",
                                    videoUrl
                                  );
                                  setOpenVideoUrl(videoUrl);
                                } else {
                                  console.log(
                                    "Watch Video button clicked but no URL available"
                                  );
                                  toast({
                                    title: "No video available",
                                    variant: "destructive",
                                  });
                                }
                              }}
                            >
                              <Eye className="h-4 w-4 mr-2" />
                              Watch Video
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
                              onClick={async (e) => {
                                e.stopPropagation();
                                const conversion = getConversionStatus(session);
                                const videoUrl = conversion?.converted_url || session?.video_url;
                                
                                if (videoUrl) {
                                  try {
                                    console.log(
                                      "Testing video URL accessibility:",
                                      videoUrl
                                    );
                                    const response = await fetch(
                                      videoUrl,
                                      { method: "HEAD" }
                                    );
                                    console.log(
                                      "Video URL test result:",
                                      response.status,
                                      response.headers.get("content-type")
                                    );
                                    if (response.ok) {
                                      toast({
                                        title: "Video URL Accessible",
                                        description: `Status: ${
                                          response.status
                                        }, Content-Type: ${response.headers.get(
                                          "content-type"
                                        )}`,
                                      });
                                    } else {
                                      toast({
                                        title: "Video URL Not Accessible",
                                        description: `Status: ${response.status}`,
                                        variant: "destructive",
                                      });
                                    }
                                  } catch (error) {
                                    console.error(
                                      "Video URL test failed:",
                                      error
                                    );
                                    toast({
                                      title: "Video URL Test Failed",
                                      description:
                                        "Could not access the video URL",
                                      variant: "destructive",
                                    });
                                  }
                                }
                              }}
                              title="Test video URL accessibility"
                            >
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                        <Link href={`/interview/${session.id}`}>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100 hover:border-purple-300"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <PlayCircle className="h-4 w-4 mr-2" />
                            Retake
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ✅ Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link href="/interview">
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto p-4"
                >
                  <div className="text-left">
                    <PlayCircle className="h-6 w-6 text-blue-600 mb-2" />
                    <div className="font-medium">Start New Interview</div>
                    <div className="text-sm text-gray-500">
                      Practice with new questions
                    </div>
                  </div>
                </Button>
              </Link>

              <Link href="/dashboard">
                <Button
                  variant="outline"
                  className="w-full justify-start h-auto p-4"
                >
                  <div className="text-left">
                    <TrendingUp className="h-6 w-6 text-green-600 mb-2" />
                    <div className="font-medium">View Progress</div>
                    <div className="text-sm text-gray-500">
                      Track your improvement
                    </div>
                  </div>
                </Button>
              </Link>

              <Button
                variant="outline"
                className="w-full justify-start h-auto p-4"
                disabled
              >
                <div className="text-left">
                  <Brain className="h-6 w-6 text-purple-600 mb-2" />
                  <div className="font-medium">AI Analysis</div>
                  <div className="text-sm text-gray-500">Coming soon</div>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Video Watch Dialog */}
      <Dialog
        open={!!openVideoUrl}
        onOpenChange={(o) => !o && setOpenVideoUrl(null)}
      >
        <DialogContent className="max-w-4xl bg-gradient-to-br from-gray-50 to-gray-100">
          <DialogHeader className="bg-white rounded-lg p-4 shadow-sm">
            <DialogTitle className="flex items-center space-x-2 text-lg font-semibold text-gray-800">
              <Video className="h-5 w-5 text-blue-600" />
              <span>Interview Video Playback</span>
            </DialogTitle>
          </DialogHeader>
          {openVideoUrl ? (
            <div className="bg-white rounded-lg p-4 shadow-sm">
              <video
                src={openVideoUrl}
                controls
                className="w-full rounded-lg shadow-lg"
                preload="metadata"
                onError={(e) => {
                  console.error("Video dialog load error:", e);
                  console.error("Video URL:", openVideoUrl);
                  const videoElement = e.target as HTMLVideoElement;
                  console.error(
                    "Video element error details:",
                    videoElement?.error
                  );
                  console.error(
                    "Video element network state:",
                    videoElement?.networkState
                  );
                  console.error(
                    "Video element ready state:",
                    videoElement?.readyState
                  );

                  // Try to fetch the video URL to check if it's accessible
                  fetch(openVideoUrl, { method: "HEAD" })
                    .then((response) => {
                      console.log(
                        "Video URL fetch response:",
                        response.status,
                        response.headers.get("content-type")
                      );
                      if (!response.ok) {
                        console.error(
                          "Video URL is not accessible:",
                          response.status
                        );
                      }
                    })
                    .catch((fetchError) => {
                      console.error("Failed to fetch video URL:", fetchError);
                    });

                  toast({
                    title: "Video Playback Error",
                    description:
                      "Unable to load video. The video file may be corrupted or inaccessible.",
                    variant: "destructive",
                  });
                }}
                onLoadedData={(e) => {
                  console.log("Video loaded successfully in dialog");
                  console.log("Video URL:", openVideoUrl);
                  const videoElement = e.target as HTMLVideoElement;
                  console.log("Video duration:", videoElement?.duration);
                  console.log(
                    "Video dimensions:",
                    videoElement?.videoWidth,
                    "x",
                    videoElement?.videoHeight
                  );
                }}
                onLoadStart={() => {
                  console.log("Video load started for URL:", openVideoUrl);
                }}
                onCanPlay={() => {
                  console.log("Video can play for URL:", openVideoUrl);
                }}
              />
              <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                <span>Recorded interview session</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpenVideoUrl(null)}
                  className="bg-gray-50 hover:bg-gray-100"
                >
                  Close Player
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
