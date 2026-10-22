import json
import re
import os
import argparse
import glob

class LogProcessor:
    def __init__(self):
        self.actions = []
        
    def timestamp_to_seconds(self, timestamp_str):
        """Convert timestamp string to seconds"""
        try:
            time_parts = timestamp_str.split(":")
            hours = int(time_parts[0])
            minutes = int(time_parts[1])
            seconds_parts = time_parts[2].split(".")
            seconds = int(seconds_parts[0])
            if len(seconds_parts) > 1:
                milliseconds = int(seconds_parts[1].ljust(3, "0"))
            else:
                milliseconds = 0
            total_seconds = hours * 3600 + minutes * 60 + seconds + milliseconds / 1000.0
            return total_seconds
        except Exception as e:
            print(f"Error parsing timestamp: {timestamp_str}")
            return None
    
    def process_input_log(self, log_file_path):
        """Process the input log file and extract actions"""
        if not os.path.exists(log_file_path):
            raise FileNotFoundError(f"Log file not found: {log_file_path}")
        actions = []
        current_software = None
        with open(log_file_path, "r", encoding="utf-8") as f:
            for line in f.readlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                try:
                    action, current_software = self._parse_log_line(line, current_software)
                    if action is not None:
                        actions.append(action)
                except json.JSONDecodeError:
                    print(f"Warning: JSON parsing error: {line}")
                    continue
                except Exception as e:
                    print(f"Warning: Processing error: {line}\nError: {str(e)}")
                    continue
        if not actions:
            raise ValueError("No valid actions found in log file")
        self.actions = actions
        return actions

    def _parse_log_line(self, line, current_software):
        event_data = json.loads(line)
        if "video_start_time" in event_data:
            return None, current_software
        timestamp = event_data.get("timestamp")
        message = event_data.get("message")
        window = event_data.get("window")
        if (window and "Screen Recorder" in window and isinstance(message, str)
                and message.startswith(("Initial Active Window", "Active Window"))):
            return None, current_software
        if message.startswith("Active Window"):
            return None, current_software
        timestamp_seconds = self.timestamp_to_seconds(timestamp)
        if timestamp_seconds is None:
            return None, current_software
        coords = [
            {"x": int(match.group(1)), "y": int(match.group(2))}
            for match in re.finditer(r'\((\d+),\s*(\d+)\)', message)
        ]
        if "Initial Active Window:" in message or "Active Window:" in message:
            current_software = window
            action = "Active Window"
        else:
            action = re.sub(r'\s*\(\d+,\s*\d+\)', '', message) if coords else message
        if timestamp == "00:00:00.000" and current_software is None:
            try:
                config_data = json.loads(message)
                return {
                    "timestamp": timestamp_seconds, "action": "CONFIG",
                    "coords": config_data, "current_software": "System Info",
                }, current_software
            except (json.JSONDecodeError, TypeError) as error:
                print(f"Warning: Invalid recording configuration: {error}")
        return {
            "timestamp": timestamp_seconds, "action": action,
            "coords": coords if coords else None, "current_software": window,
            **({"clipboard_text": event_data["clipboard_text"]}
               if isinstance(event_data.get("clipboard_text"), str) else {}),
        }, current_software
    
    def calculate_backspace_deletions(self, duration, base_rate=10):
        """Calculate how many characters to delete based on backspace duration"""
        # Characters per second when holding backspace
        if duration <= 0.05:  # Single tap
            return 1
        elif duration <= 0.5:  # Short hold
            return max(1, int(duration * base_rate))
        else:  # Long hold - accelerated deletion
            # First 0.5s at base rate, then accelerated
            base_deletions = int(0.5 * base_rate)
            accelerated_time = duration - 0.5
            accelerated_deletions = int(accelerated_time * base_rate * 2)  # 2x speed
            return base_deletions + accelerated_deletions

    def normalize_typing_key(self, key):
        """Normalize recorder key names that should become typed characters."""
        if key == "NUMPAD_DECIMAL":
            return "."
        if key.startswith("NUMPAD_") and key[-1:].isdigit():
            return key[-1]
        return key

    def merge_keyboard_events(self, actions, time_threshold=5.0):
        """Merge consecutive keyboard events into typing actions with backspace handling"""
        merged_actions = []
        buffer = []
        last_timestamp = None
        current_window = None
        last_click_coords = None
        
        i = 0
        while i < len(actions):
            action = actions[i]
            
            if action["action"] == "CONFIG":
                merged_actions.append(action)
                i += 1
                continue
                
            message = action["action"]
            window = action["current_software"]
            
            if window:
                current_window = window
            
            # Track click coordinates for typing position
            if "Click" in message and action["coords"]:
                last_click_coords = action["coords"]
            
            # Handle backspace events (including with modifiers)
            if ("BACKSPACE" in message and 
                ("Key Press:" in message or "Hotkey:" in message)):
                i, buffer = self._consume_backspace(actions, i, buffer)
                continue
            
            # Handle regular key press events
            elif "Key Press:" in message:
                key = message.replace("Key Press:", "").strip()
                buffer, last_timestamp, current_window, last_click_coords = self._process_key_press(
                    key, action, merged_actions, buffer, last_timestamp,
                    current_window, last_click_coords, time_threshold,
                )
            
            else:
                buffer, last_timestamp = self._process_non_key_event(
                    action, merged_actions, buffer, last_timestamp, last_click_coords, current_window,
                )
            
            i += 1
        
        # Handle remaining buffer
        if buffer:
            self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
        
        return merged_actions

    def _process_non_key_event(
        self, action, merged_actions, buffer, last_timestamp, last_click_coords, current_window,
    ):
        message = action["action"]
        if ("Hotkey: SHIFT+" in message and "BACKSPACE" not in message
                and len(message.replace("Hotkey: SHIFT+", "").strip()) == 1):
            buffer.append(message.replace("Hotkey: SHIFT+", "").strip())
            last_timestamp = action["timestamp"]
        elif message.startswith("Hotkey: CTRL+"):
            if buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            merged_actions.append({
                "timestamp": action["timestamp"], "action": message,
                "coords": last_click_coords, "current_software": current_window,
                **({"clipboard_text": action["clipboard_text"]}
                   if isinstance(action.get("clipboard_text"), str) else {}),
            })
        elif ("Key Release:" in message or message == "Hotkey: SHIFT"
              or ("Hotkey:" in message and "BACKSPACE" not in message)):
            pass
        else:
            if buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            merged_actions.append(action)
        return buffer, last_timestamp

    def _flush_typing(self, merged_actions, buffer, last_timestamp, last_click_coords, current_window):
        merged_actions.append({
            "timestamp": last_timestamp, "action": f"Type: {''.join(buffer)}",
            "coords": last_click_coords, "current_software": current_window,
        })

    def _process_key_press(
        self, key, action, merged_actions, buffer, last_timestamp,
        current_window, last_click_coords, time_threshold,
    ):
        timestamp = action["timestamp"]
        normalized_key = self.normalize_typing_key(key)
        if key == 'ENTER':
            if buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            merged_actions.append({
                "timestamp": timestamp, "action": "Press ENTER",
                "coords": last_click_coords, "current_software": current_window,
            })
        elif key == 'SPACE':
            if last_timestamp and (timestamp - last_timestamp) > time_threshold and buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            buffer.append(" ")
            last_timestamp = timestamp
            current_window = current_window or action.get("current_software")
            if action.get("coords") is not None:
                last_click_coords = action.get("coords")
        elif key == 'DELETE' or key == 'BACKSPACE':
            if buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            merged_actions.append({
                "timestamp": timestamp, "action": "Press " + key,
                "coords": last_click_coords, "current_software": current_window,
            })
        elif len(normalized_key) == 1:
            if last_timestamp and (timestamp - last_timestamp) > time_threshold and buffer:
                self._flush_typing(merged_actions, buffer, last_timestamp, last_click_coords, current_window)
                buffer = []
            buffer.append(normalized_key)
            last_timestamp = timestamp
        return buffer, last_timestamp, current_window, last_click_coords

    def _consume_backspace(self, actions, index, buffer):
        backspace_start = actions[index]["timestamp"]
        backspace_end = backspace_start
        next_index = index + 1
        while next_index < len(actions):
            next_action = actions[next_index]
            next_message = next_action["action"]
            if "Key Release:" in next_message and "BACKSPACE" in next_message:
                backspace_end = next_action["timestamp"]
                break
            if not ("BACKSPACE" in next_message and
                    ("Key Press:" in next_message or "Hotkey:" in next_message)):
                break
            next_index += 1
        chars_to_delete = self.calculate_backspace_deletions(backspace_end - backspace_start)
        if buffer:
            if chars_to_delete >= len(buffer):
                buffer = []
            else:
                buffer = buffer[:-chars_to_delete]
        return next_index, buffer

    
    def merge_mouse_events(self, actions):

        def coords_close(a, b, tol=3):
            if a is None or b is None:
                return False
            return max(abs(a[0] - b[0]), abs(a[1] - b[1])) <= tol
        """Merge click and release events"""
        merged_actions = []
        i = 0
        
        while i < len(actions):
            current_action = actions[i]
            message = current_action["action"]
            
            # Handle click events
            if "Click" in message and current_action["coords"]:
                coords = current_action["coords"][0]
                click_coords = (coords["x"], coords["y"])
                
                # Look for corresponding release event
                if i + 1 < len(actions):
                    next_action = actions[i + 1]
                    
                # Case 1: Click followed by Release
                if i + 1 < len(actions):
                    next_action = actions[i + 1]
                    if ("Release" in next_action["action"] and next_action.get("coords")):
                        r0 = next_action["coords"][0]
                        rel_coords = (r0["x"], r0["y"])
                        if coords_close(click_coords, rel_coords, 5):
                            merged_actions.append({
                                "timestamp": next_action["timestamp"],
                                "evidence_timestamp": current_action["timestamp"],
                                "action": message,  # e.g., "LClick at"
                                "coords": current_action["coords"],  # keep the click coords
                                "current_software": current_action.get("current_software")
                            })
                            i += 2
                            continue

                # Case 2: Click → Active Window → Release
                if i + 2 < len(actions):
                    mid_action = actions[i + 1]
                    rel_action = actions[i + 2]
                    if ("Active Window" in mid_action["action"] and
                        "Release" in rel_action["action"] and rel_action.get("coords")):
                        r0 = rel_action["coords"][0]
                        rel_coords = (r0["x"], r0["y"])
                        if coords_close(click_coords, rel_coords, 5):
                            merged_actions.append({
                                "timestamp": rel_action["timestamp"],
                                "evidence_timestamp": current_action["timestamp"],
                                "action": message,
                                "coords": current_action["coords"],
                                "current_software": current_action.get("current_software")
                            })
                            i += 3
                            continue
            merged_actions.append(current_action)
            i += 1
        
        return merged_actions

    def fold_text_paste(self, actions):
        """Represent text paste as an input step and omit its source-only copy gesture."""
        merged = []
        for index, action in enumerate(actions):
            message = action.get("action") or ""
            if message == "Hotkey: CTRL+C" and any(
                isinstance(later.get("clipboard_text"), str)
                and later.get("action") == "Hotkey: CTRL+V"
                for later in actions[index + 1:]
            ):
                if merged and merged[-1].get("action") == "DragStart at":
                    merged.pop()
                continue
            if message == "Hotkey: CTRL+V" and not action.get("clipboard_text"):
                raise ValueError("录制的 Ctrl+V 缺少可用的剪贴板文本，无法生成输入步骤")
            if message == "Hotkey: CTRL+V" and isinstance(action.get("clipboard_text"), str):
                merged.append({**action, "action": "Paste text"})
                continue
            merged.append(action)
        return merged
    
    def process_scroll_events(self, actions):
        """Group consecutive scroll events"""
        processed_actions = []
        i = 0
        while i < len(actions):
            current_action = actions[i]
            message = current_action["action"]
            if "Scroll" in message:
                scroll_actions = [current_action]
                while i + 1 < len(actions) and "Scroll" in actions[i + 1]["action"]:
                    i += 1
                    scroll_actions.append(actions[i])
                processed_actions.append(self._merge_scroll_group(scroll_actions))
            else:
                processed_actions.append(current_action)
            i += 1
        return processed_actions

    def _merge_scroll_group(self, scroll_actions):
        current_action = scroll_actions[0]
        scroll_down_count = 0
        scroll_up_count = 0
        coords_count = {}
        for action in scroll_actions:
            if "ScrollDown" in action["action"]:
                scroll_down_count += 1
            elif "ScrollUp" in action["action"]:
                scroll_up_count += 1
            coord = action["coords"][0] if action["coords"] else None
            if coord:
                coord_str = f"{coord['x']},{coord['y']}"
                if coord_str in coords_count:
                    coords_count[coord_str][0] += 1
                else:
                    coords_count[coord_str] = [1, action["timestamp"], coord]
        max_count = 0
        best_timestamp = current_action["timestamp"]
        best_coord = current_action["coords"][0] if current_action["coords"] else None
        for count, timestamp, coord in coords_count.values():
            if count > max_count:
                max_count = count
                best_timestamp = timestamp
                best_coord = coord
        if scroll_down_count >= scroll_up_count:
            scroll_action = "ScrollDown"
            scroll_count = scroll_down_count - scroll_up_count
        else:
            scroll_action = "ScrollUp"
            scroll_count = scroll_up_count - scroll_down_count
        return {
            "timestamp": best_timestamp,
            "action": f"{scroll_action} at",
            "coords": [best_coord] if best_coord else None,
            "current_software": current_action["current_software"],
            "scroll_count": scroll_count,
        }
    
    def merge_adjacent_typing(self, actions, time_threshold=5.0):
        """Merge adjacent typing actions that are close in time and location"""
        if not actions:
            return actions
            
        merged_actions = []
        i = 0
        
        while i < len(actions):
            current_action = actions[i]
            
            # Check if this is a typing action
            if current_action["action"].startswith("Type:"):
                # Collect consecutive typing actions within threshold
                typing_sequence = [current_action]
                j = i + 1
                
                while j < len(actions):
                    next_action = actions[j]
                    
                    # Check if next action is also typing
                    if not next_action["action"].startswith("Type:"):
                        break
                    
                    # Check time gap
                    time_gap = next_action["timestamp"] - typing_sequence[-1]["timestamp"]
                    if time_gap > time_threshold:
                        break
                    
                    # Check if coordinates are similar (same text field)
                    if (current_action["coords"] and next_action["coords"] and
                        abs(current_action["coords"][0]["x"] - next_action["coords"][0]["x"]) <= 10 and
                        abs(current_action["coords"][0]["y"] - next_action["coords"][0]["y"]) <= 10):
                        typing_sequence.append(next_action)
                        j += 1
                    else:
                        break
                
                # Merge the typing sequence if more than one action
                if len(typing_sequence) > 1:
                    # Combine all text
                    combined_text = ""
                    for typing_action in typing_sequence:
                        text = typing_action["action"].replace("Type: ", "")
                        combined_text += text
                    
                    # Create merged action using the last timestamp and first coordinates
                    merged_action = {
                        "timestamp": typing_sequence[-1]["timestamp"],
                        "action": f"Type: {combined_text}",
                        "coords": typing_sequence[0]["coords"],
                        "current_software": typing_sequence[0]["current_software"]
                    }
                    merged_actions.append(merged_action)
                    i = j
                else:
                    # Single typing action, keep as is
                    merged_actions.append(current_action)
                    i += 1
            else:
                # Non-typing action, keep as is
                merged_actions.append(current_action)
                i += 1
        merged_actions = [
            a for a in merged_actions if "Active Window" not in (a.get("action") or "")
        ]
        return merged_actions
   
    def merge_drag_events(self, actions):
        merged = []
        i = 0
        while i < len(actions):
            a0 = actions[i]
            msg0 = a0.get("action") or ""
            # Detect DragStart
            if msg0.startswith("DragStart") and a0.get("coords"):
                start_coord = a0["coords"][0] if a0["coords"] else None
                path = []
                path.append(start_coord)
                j = i + 1
                end_action = None
                while j < len(actions):
                    aj = actions[j]
                    msgj = aj.get("action") or ""
                    # Collect DragMove points
                    if msgj.startswith("DragMove") and aj.get("coords"):
                        path.append(aj["coords"][0])
                        j += 1
                        continue
                    # Allow Active Window noise
                    if "Active Window" in msgj:
                        j += 1
                        continue
                    # Termination on DragEnd (LDragEnd variants)
                    if "DragEnd" in msgj:
                        path.append(aj["coords"][0])
                        # Build outputs
                        start_out = {
                            "timestamp": a0["timestamp"],
                            "action": "DragStart at",
                            "coords": [start_coord] if start_coord else None,
                            "current_software": a0.get("current_software"),
                        }
                        if path:
                            start_out["path"] = path                       
                        merged.append(start_out)
                        i = j + 1
                        end_action = True
                        break
                    # Unexpected break in drag sequence -> fall back to emitting the original DragStart and continue
                    break
                if end_action:
                    continue
                # No end found — keep original DragStart and advance one
                merged.append(a0)
                i += 1
                continue
            # Not a DragStart — keep as-is
            merged.append(a0)
            i += 1
        return merged
    
    def cleanup_preceded_double_clicks(self, actions, tol=5):
        """If a DoubleClick is immediately preceded by a Click in ~same spot, drop the single Click.
        This should run as the last filter before output."""
        def get_xy(act):
            try:
                c = act.get("coords") or []
                if not c:
                    return None
                return (int(c[0]["x"]), int(c[0]["y"]))
            except Exception:
                return None
        def is_click(act):
            msg = (act.get("action") or "").lower()
            # single click but not double click
            return ("click" in msg) and ("dblclick" not in msg) and ("double" not in msg)
        def is_dblclick(act):
            msg = (act.get("action") or "").lower()
            return ("dblclick" in msg) or ("doubleclick" in msg) or ("double click" in msg)
        def close(a, b, t=tol):
            if a is None or b is None:
                return False
            return max(abs(a[0]-b[0]), abs(a[1]-b[1])) <= t

        out = []
        for act in actions:
            if is_dblclick(act) and out:
                prev = out[-1]
                if is_click(prev) and close(get_xy(prev), get_xy(act), tol):
                    # Drop the preceding single click, but keep its first mouse-down
                    # as the evidence anchor for the complete double-click gesture.
                    first_press = prev.get("evidence_timestamp", prev.get("timestamp"))
                    if first_press is not None:
                        act = act.copy()
                        act["evidence_timestamp"] = first_press
                    out.pop()
                    out.append(act)
                    continue
            out.append(act)
        return out
    
    def cleanup_click_before_drag(self, actions, tol=5):
        def get_xy(act):
            try:
                c = act.get("coords") or []
                if not c:
                    return None
                return (int(c[0]["x"]), int(c[0]["y"]))
            except Exception:
                return None

        def is_lclick(act):
            msg = (act.get("action") or "").lower()
            # single left click only (not double click, not drag)
            return ("lclick" in msg or "left click" in msg) and ("double" not in msg) and ("dblclick" not in msg)

        def is_dragstart(act):
            msg = (act.get("action") or "").lower()
            return msg.startswith("dragstart")

        def close(a, b):
            if a is None or b is None:
                return False
            return max(abs(a[0]-b[0]), abs(a[1]-b[1])) <= tol

        out = []
        for act in actions:
            if is_dragstart(act) and out and is_lclick(out[-1]) and close(get_xy(out[-1]), get_xy(act)):
                # Drop the LClick immediately before this DragStart
                out.pop()
            out.append(act)
        return out


    def process_log_file(self, log_file_path, output_path=None, time_threshold=5.0):
        """Main processing function"""
        # Step 1: Parse input log
        actions = self.process_input_log(log_file_path)
        print(f"Parsed {len(actions)-1} raw actions")
        
        # Step 2: Merge keyboard events with custom time threshold
        actions = self.merge_keyboard_events(actions, time_threshold)
        print(f"After keyboard merge: {len(actions)-1} actions")
        
        # Step 3: Merge mouse events
        actions = self.merge_mouse_events(actions)
        print(f"After mouse merge: {len(actions)-1} actions")

        # Step 4: Merge drag events
        actions = self.merge_drag_events(actions)
        print(f"After drag merge: {len(actions)-1} actions")
        
        # Step 5: Process scroll events
        actions = self.process_scroll_events(actions)
        print(f"After scroll processing: {len(actions)-1} actions")
        
        # Step 6: Merge adjacent typing actions
        actions = self.merge_adjacent_typing(actions, time_threshold)
        print(f"After typing merge: {len(actions)-1} actions")

        # Step 7: Remove single-click directly preceding a nearby double-click
        actions = self.cleanup_preceded_double_clicks(actions, tol=5)
        print(f"After double-click cleanup: {len(actions)-1} actions")

        # Step 8: Remove single-click directly preceding a nearby drag
        actions = self.cleanup_click_before_drag(actions, tol=5)
        if actions:
            actions.pop()
        actions = self.fold_text_paste(actions)
        print(f"After click-before-drag and final recording cleanup: {len(actions)-1} actions")
        
        # Step 9: Sort and Save processed log
        actions.sort(key=lambda a: a.get("timestamp", 0))
        if output_path:
            with open(output_path, 'w', encoding='utf-8') as f:
                json.dump(actions, f, indent=2, ensure_ascii=False)
            print(f"Processed log saved to: {output_path}")
        
        return actions

def main():
    """Command line interface for the log processor"""
    args = _build_parser().parse_args()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    input_dir = os.path.join(base_dir, "projects", args.project, "inputs")
    input_file = _find_input_file(input_dir, args.project)
    if input_file is None:
        return 1
    args.output = _resolve_output_path(args.output, base_dir, args.project)
    try:
        return _run_processor(args, input_file)
    except Exception as error:
        print(f"Error processing log: {error}")
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


def _build_parser():
    parser = argparse.ArgumentParser(
        description='Process GUI automation log files',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python log_processor.py --project qatar_booking
  python log_processor.py --project qatar_booking --output result.json
  python log_processor.py --project qatar_booking --typing-delay 10
  python log_processor.py -p qatar_booking -o result.json -t 3.5
        """
    )
    
    parser.add_argument(
        '--project', '-p',
        required=True,
        help='Project name (required). Will look for log file in /projects/{project_name}/inputs/'
    )
    
    parser.add_argument(
        '--output', '-o',
        help='Output JSON file path (default: /projects/{project_name}/outputs/processed_log.json)'
    )
    
    parser.add_argument(
        '--typing-delay', '-t',
        type=float,
        default=5.0,
        help='Maximum time gap (seconds) between keystrokes to consider them as one typing action (default: 5.0)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose output'
    )
    
    return parser


def _find_input_file(input_dir, project):
    if not os.path.exists(input_dir):
        print(f"Error: Project directory not found: {input_dir}")
        print(f"Please ensure the project '{project}' exists and has an inputs folder.")
        return None
    log_files = []
    for ext in ['*.txt', '*.log', '*.json']:
        log_files.extend(glob.glob(os.path.join(input_dir, ext)))
    
    if not log_files:
        print(f"Error: No log files found in {input_dir}")
        print("Supported formats: .txt, .log, .json")
        return None
    
    if len(log_files) > 1:
        print(f"Error: Multiple log files found in {input_dir}")
        print("Found files:")
        for f in log_files:
            print(f"  {os.path.basename(f)}")
        print("Please ensure only one log file exists in the inputs directory.")
        return None
    return log_files[0]


def _resolve_output_path(output, base_dir, project):
    if not output:
        project_dir = os.path.join(base_dir, "projects", project)
        os.makedirs(project_dir, exist_ok=True)
        return os.path.join(project_dir, f"{project}_processed_log.json")
    else:
        output_dir = os.path.dirname(output)
        if output_dir and not os.path.exists(output_dir):
            os.makedirs(output_dir)
        return output


def _run_processor(args, input_file):
    processor = LogProcessor()
    if args.verbose:
        print(f"Project: {args.project}")
        print(f"Input file: {input_file}")
        print(f"Output file: {args.output}")
        print(f"Typing delay threshold: {args.typing_delay}s")
        print("-" * 50)
    processed_actions = processor.process_log_file(
        input_file, args.output, time_threshold=args.typing_delay
    )
    print("Processing completed successfully")
    print(f"Total actions: {len(processed_actions)}")
    print(f"Output saved to: {args.output}")
    if args.verbose:
        action_types = {}
        for action in processed_actions:
            action_type = action["action"].split()[0] if action["action"] else "Unknown"
            action_types[action_type] = action_types.get(action_type, 0) + 1
        print("\nAction breakdown:")
        for action_type, count in sorted(action_types.items()):
            print(f"  {action_type}: {count}")
    return 0

# Example usage
if __name__ == "__main__":
    exit_code = main()
