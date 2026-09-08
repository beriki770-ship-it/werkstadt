#!/usr/bin/env python3
"""Convert a Claude Code session transcript (.jsonl) into a replay file for a
live visualizer.

Usage: python export_replay.py <session.jsonl> <out.json>

How sidechains work in the real data (found by inspecting actual transcripts,
2026-09-05): a subagent is NOT inline in the main file. Its full transcript is
a separate file at <session-dir>/subagents/agent-<agentId>.jsonl, plus a
sibling agent-<agentId>.meta.json holding {agentType, description, toolUseId,
parentAgentId, spawnDepth}. `toolUseId` is the id of the Agent tool_use block
in the PARENT transcript (main session or another agent) that spawned it --
that's the join key. The subagents/ dir is FLAT: nested agents (spawnDepth>1)
live next to top-level ones and link up via parentAgentId, so no recursion
into subfolders is needed. Lines with isSidechain:true only appear inside
those agent-*.jsonl files, never in the main file (main file's own lines are
all isSidechain:false). Hook lines have type:"attachment" and are skipped, as
are non-transcript control lines like type:"queue-operation" seen in the
input (undocumented in the spec but present in real data -- must not crash).

Schema addition (2026-09-05, for per-call worker-drone rendering): every
"kind":"tool" event now carries "id" (the tool_use block's id). A matching
"kind":"tool_end" event is emitted when the corresponding tool_result block
appears, carrying the same "id" and "ok" (true/false, from `is_error`). A
tool_use with no tool_result anywhere in the transcript gets a synthetic
tool_end at the session's final timestamp with "ok": null, so nothing in the
visualizer flies forever. Agent tool calls are unchanged -- they keep using
"agent_start"/"agent_end", not "tool"/"tool_end".
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# File-editing tools whose input carries a path worth surfacing on the timeline.
PATH_TOOLS = {"Read", "Edit", "Write", "MultiEdit", "Glob", "Grep"}

# Redact anything that looks like a credential before it reaches a summary
# string -- transcripts routinely contain Bash commands with pasted secrets.
SECRET_PATTERNS = [
    re.compile(r"(Authorization|Bearer)\s*[:=]?\s*\S+", re.I),
    re.compile(r"(api[_-]?key|apikey|password|passwd|secret|token)\s*[:=]\s*\S+", re.I),
    re.compile(r"sk-[A-Za-z0-9_-]{10,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"[A-Za-z0-9_-]{32,}"),  # long opaque tokens/hashes
]


def redact(text):
    for pat in SECRET_PATTERNS:
        text = pat.sub("[REDACTED]", text)
    return text


def to_ms(iso_ts):
    # Transcript timestamps are ISO-8601 UTC ("...Z").
    return datetime.fromisoformat(iso_ts.replace("Z", "+00:00")).timestamp() * 1000


def clip(text, n):
    text = " ".join(text.split())  # collapse newlines/whitespace for a one-line summary
    text = redact(text)
    return text[:n]


def iter_transcript_lines(path):
    """Yield parsed JSON objects from a transcript file, skipping hook
    attachments and any non-transcript control lines (e.g. queue-operation)
    that carry no `type` we recognize."""
    with open(path, encoding="utf-8", errors="ignore") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("type") == "attachment":
                continue
            if "message" not in obj:
                continue  # e.g. queue-operation lines carry no message
            yield obj


def load_agent_metas(subagents_dir):
    """toolUseId -> {agent_id, agentType, description, parentAgentId}"""
    metas = {}
    if not subagents_dir.is_dir():
        return metas
    for meta_path in subagents_dir.glob("agent-*.meta.json"):
        agent_id = meta_path.stem.replace("agent-", "").replace(".meta", "")
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        data["agent_id"] = agent_id
        tool_use_id = data.get("toolUseId")
        if tool_use_id:
            metas[tool_use_id] = data
    return metas


def bash_summary(input_obj):
    cmd = input_obj.get("command", "")
    return clip(cmd.splitlines()[0] if cmd else "", 60)


def tool_summary(name, input_obj):
    if name in ("Bash", "PowerShell"):
        return bash_summary(input_obj)
    if name == "Agent":
        return clip(input_obj.get("description", ""), 60)
    return clip(json.dumps(input_obj, ensure_ascii=False)[:120], 60)


def tool_path(name, input_obj):
    if name in PATH_TOOLS:
        p = input_obj.get("file_path") or input_obj.get("path")
        if p:
            return p.replace("\\", "/")
    return None


def process_file(path, agent_id, session_start_ms, events, pending_agent_calls, agent_meta_by_id,
                  pending_tool_calls):
    """Walk one transcript file (main session or one subagent) and append its
    events (tagged with agent_id) into the shared `events` list. Returns the
    (first_ts, last_ts) ms range seen in this file, or (None, None) if empty."""
    first_ts = last_ts = None
    for obj in iter_transcript_lines(path):
        ts = obj.get("timestamp")
        if not ts:
            continue
        ts_ms = to_ms(ts)
        if first_ts is None:
            first_ts = ts_ms
        last_ts = ts_ms
        t_rel = ts_ms - session_start_ms

        msg = obj["message"]
        role = msg.get("role")
        content = msg.get("content")

        if role == "user":
            if isinstance(content, str):
                events.append({"t": t_rel, "agent": agent_id, "kind": "prompt",
                                "summary": clip(content, 60)})
            elif isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "text":
                        events.append({"t": t_rel, "agent": agent_id, "kind": "prompt",
                                        "summary": clip(block.get("text", ""), 60)})
                    elif btype == "tool_result":
                        # A tool_result whose id matches an outstanding Agent
                        # call means that subagent has now finished (its
                        # result was returned to the caller).
                        tu_id = block.get("tool_use_id")
                        if tu_id in pending_agent_calls:
                            child_id = pending_agent_calls.pop(tu_id)
                            events.append({"t": t_rel, "agent": agent_id, "kind": "agent_end",
                                            "summary": ""})
                            if child_id in agent_meta_by_id:
                                agent_meta_by_id[child_id]["ended_ms_hint"] = t_rel
                        elif tu_id in pending_tool_calls:
                            # Matching tool_end for a plain (non-Agent) tool
                            # call -- drives the "worker drone returned" beat.
                            call_agent = pending_tool_calls.pop(tu_id)
                            events.append({"t": t_rel, "agent": call_agent, "kind": "tool_end",
                                            "id": tu_id, "ok": not block.get("is_error", False)})
        elif role == "assistant":
            if isinstance(content, list):
                for block in content:
                    if not isinstance(block, dict):
                        continue
                    btype = block.get("type")
                    if btype == "text":
                        events.append({"t": t_rel, "agent": agent_id, "kind": "text",
                                        "summary": clip(block.get("text", ""), 60)})
                    elif btype == "tool_use":
                        name = block.get("name", "")
                        input_obj = block.get("input", {}) or {}
                        if name == "Agent":
                            # Record this call so we can pair it to its
                            # subagent (via meta.json toolUseId) and to the
                            # tool_result that signals completion.
                            pending_agent_calls[block.get("id")] = block.get("id")
                            events.append({"t": t_rel, "agent": agent_id, "kind": "agent_start",
                                            "tool": "Agent",
                                            "summary": clip(input_obj.get("description", ""), 60)})
                        else:
                            tool_id = block.get("id")
                            ev = {"t": t_rel, "agent": agent_id, "kind": "tool",
                                  "tool": name, "id": tool_id, "summary": tool_summary(name, input_obj)}
                            p = tool_path(name, input_obj)
                            if p:
                                ev["path"] = p
                            events.append(ev)
                            if tool_id:
                                pending_tool_calls[tool_id] = agent_id
    return first_ts, last_ts


def build_replay(session_path):
    session_path = Path(session_path)
    session_dir = session_path.parent / session_path.stem
    subagents_dir = session_dir / "subagents"
    metas = load_agent_metas(subagents_dir)  # toolUseId -> meta dict

    # --- pass 1: find session start (first timestamped line) ---
    session_start_ms = None
    for obj in iter_transcript_lines(session_path):
        if obj.get("timestamp"):
            session_start_ms = to_ms(obj["timestamp"])
            break
    if session_start_ms is None:
        raise ValueError(f"no timestamped lines found in {session_path}")

    events = []
    pending_agent_calls = {}  # toolUseId -> toolUseId (present == not yet resolved to a result)
    pending_tool_calls = {}   # toolUseId -> agent_id (present == no tool_result seen yet)
    agent_meta_by_id = {}     # agent_id -> meta dict, gains started_ms/ended_ms

    main_first, main_last = process_file(session_path, "main", session_start_ms,
                                          events, pending_agent_calls, agent_meta_by_id,
                                          pending_tool_calls)
    last_ts_overall = main_last or main_first

    # --- walk every subagent file discovered under subagents/, flat ---
    for tool_use_id, meta in metas.items():
        agent_id = meta["agent_id"]
        agent_file = subagents_dir / f"agent-{agent_id}.jsonl"
        if not agent_file.exists():
            continue
        agent_meta_by_id[agent_id] = meta
        events.append({"t": 0, "agent": agent_id, "kind": "agent_start", "summary": ""})
        first_ts, last_ts = process_file(agent_file, agent_id, session_start_ms,
                                          events, pending_agent_calls, agent_meta_by_id,
                                          pending_tool_calls)
        meta["started_ms"] = (first_ts - session_start_ms) if first_ts else 0
        meta["ended_ms"] = (last_ts - session_start_ms) if last_ts else meta["started_ms"]
        if last_ts and last_ts > last_ts_overall:
            last_ts_overall = last_ts
        # fix the placeholder agent_start event's timestamp to the real start
        for ev in events:
            if ev["agent"] == agent_id and ev["kind"] == "agent_start" and ev["t"] == 0:
                ev["t"] = meta["started_ms"]
                break

    # Any tool_use with no matching tool_result anywhere in the transcript
    # (call cut off mid-flight, or the result line was malformed/missing) --
    # close it out at the session's last timestamp so it doesn't fly forever.
    final_t = int((last_ts_overall or session_start_ms) - session_start_ms)
    for tool_id, call_agent in pending_tool_calls.items():
        events.append({"t": final_t, "agent": call_agent, "kind": "tool_end",
                        "id": tool_id, "ok": None})

    events.sort(key=lambda e: e["t"])

    # --- session metadata: title = first user prompt of the main file ---
    title = ""
    for ev in events:
        if ev["agent"] == "main" and ev["kind"] == "prompt":
            title = ev["summary"][:80]
            break

    cwd = ""
    session_id = session_path.stem
    for obj in iter_transcript_lines(session_path):
        if obj.get("cwd"):
            cwd = obj["cwd"].replace("\\", "/")
        if obj.get("sessionId"):
            session_id = obj["sessionId"]
        if cwd:
            break

    agents = [{"id": "main", "label": "Orchestrator"}]
    for tool_use_id, meta in metas.items():
        agent_id = meta["agent_id"]
        if agent_id not in agent_meta_by_id or "started_ms" not in meta:
            continue  # meta whose file was missing, skipped above
        label = meta.get("description") or ""
        if not label:
            # fall back to the first 40 chars of the agent's own first prompt
            label = clip(next((e["summary"] for e in events
                                if e["agent"] == agent_id and e["kind"] == "prompt"), ""), 40)
        agents.append({
            "id": agent_id,
            "label": label[:60],
            "started_ms": meta["started_ms"],
            "ended_ms": meta["ended_ms"],
        })

    replay = {
        "session": {
            "id": session_id,
            "cwd": cwd,
            "started": datetime.fromtimestamp(session_start_ms / 1000, tz=timezone.utc)
                               .isoformat().replace("+00:00", "Z"),
            "duration_ms": int(last_ts_overall - session_start_ms),
            "title": title,
        },
        "agents": agents,
        "events": [{**e, "t": int(e["t"])} for e in events],
    }
    return replay


def main():
    if len(sys.argv) != 3:
        print("usage: export_replay.py <session.jsonl> <out.json>", file=sys.stderr)
        sys.exit(1)
    replay = build_replay(sys.argv[1])
    out_path = Path(sys.argv[2])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(replay, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out_path} ({len(replay['events'])} events, {len(replay['agents'])} agents)")


if __name__ == "__main__":
    main()
