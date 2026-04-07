# Design Doc: Mashrou3 Dactoor Bug Fixes

## Overview
This design addresses two critical bugs in the Mashrou3 Dactoor game: a sync issue in the host's player approval process and an infinite loading screen for players joining a game.

## BUG 1: Host Approval Sync Failure (HostGameRoom.jsx)

### Problem
The current implementation of `handleRequest` removes the join request from the UI immediately (optimistically) before the backend confirms success. If the RPC fails or is slow, the host loses visibility of the request, and the player is not added to the game, causing confusion.

### Proposed Solution
1. **Track Processing State**: Introduce a new state variable `processingRequests` to store IDs of requests currently being handled by the server.
2. **Remove Optimistic Update**: Do not filter the `requests` array at the start of `handleRequest`.
3. **UI Feedback**: Provide visual feedback (spinner or disabled buttons) for the specific request row being processed.
4. **Reliable Cleanup**: Allow the Realtime listener (which calls `fetchRequests` on update) to naturally remove the request from the list once its status is no longer `pending`.

### Components Involved
- `HostGameRoom.jsx`: `handleRequest` function and its associated UI logic.

## BUG 2: Infinite "Joining game..." Screen (PlayerGameView.jsx)

### Problem
In `fetchInitialData`, the code checks variables `r` and `rError` which are undefined because the actual room fetch call is missing. This causes a `ReferenceError` that crashes the initialization logic, leaving the player on the loading spinner indefinitely.

### Proposed Solution
1. **Add Missing Fetch**: Explicitly fetch the room data using `supabase.from('rooms')` before checking its existence.
2. **Correct Variable Usage**: Ensure the fetched room data is correctly assigned to the `room` state.

### Components Involved
- `PlayerGameView.jsx`: `fetchInitialData` function.

## Verification Plan

### Manual Testing
- **Host Room**: Join a game as a player, then as a host, click Approve. Observe the loading state and ensure the request only disappears after success, and the player appears in the "Ready Players" list.
- **Player View**: Join a game and verify that the "Joining game..." screen resolves to the lobby or the current question.

### Automated Tests
- (Optional) Browser-based tests to simulate the join flow and verify state transitions.
