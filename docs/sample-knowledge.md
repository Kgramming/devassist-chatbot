# Asyncio in Python: A Practical Field Guide

This guide covers the core mental models and everyday patterns of Python's
`asyncio` library. It is written as reference material for developers who
already know synchronous Python and want to write correct concurrent code.

## 1. The event loop in one paragraph

`asyncio` runs your program on a single thread inside an **event loop**.
The loop keeps a queue of ready coroutines and switches between them at
`await` points. Because switching is cooperative, a coroutine that never
awaits will starve everything else on the loop. `asyncio.run(main())`
creates a new event loop, runs `main()` until it finishes, then closes
the loop. You should call `asyncio.run()` exactly once per program —
it is the intended entry point and it manages loop lifecycle for you.

## 2. Coroutines, tasks, and futures

- A **coroutine** is what you get when you call an `async def` function.
  Calling it does not run any code; it returns a coroutine object.
- A **task** (`asyncio.create_task(coro)`) schedules a coroutine on the
  event loop so it starts running independently. Use tasks for genuine
  concurrency: fire off several tasks, then await them together.
- A **future** is a low-level placeholder for a result that does not
  exist yet. You will rarely create futures directly; tasks are built
  on top of them.

Rule of thumb: `await` a coroutine when you want its result inline;
wrap it in `create_task` when you want it to run concurrently with
other work.

## 3. gather vs wait vs wait_for

These three helpers look similar but behave differently.

**`asyncio.gather(*awaitables)`** runs everything concurrently and
returns a list of results **in the order the awaitables were passed
in, not in completion order**. If any awaitable raises, `gather`
propagates the first exception by default and the remaining results
are lost unless you pass `return_exceptions=True`, which puts
exception objects into the result list instead of raising.

**`asyncio.wait(fs, timeout=...)`** takes a set of tasks/futures and
returns two sets: `(done, pending)`. It does not return results
directly — you collect them from the done tasks yourself. It is the
right tool when you need fine control, e.g. "proceed as soon as any
two of five downloads finish".

**`asyncio.wait_for(coro, timeout)`** awaits a single coroutine with a
deadline. If the timeout expires first, `wait_for` **cancels the inner
task** and raises `asyncio.TimeoutError`. This is different from
`wait`, which simply leaves unfinished work in the `pending` set
without cancelling anything.

Quick chooser: ordered results of everything → `gather`; partial
completion handling → `wait`; single deadline with cancellation →
`wait_for`.

## 4. Common pitfalls and fixes

**Pitfall 1: blocking the loop.** Calling `time.sleep(5)` or a
CPU-heavy function inside a coroutine freezes the entire event loop —
no other task progresses. Fix: use `await asyncio.sleep(5)` for
pauses, and run CPU-bound or blocking I/O work in an executor with
`await asyncio.to_thread(blocking_fn)`.

**Pitfall 2: forgetting `await`.** `fetch_data()` without `await`
returns a coroutine that never runs, and Python emits a
"coroutine was never awaited" warning. Worse, the bug is silent at
the call site. Fix: treat every bare coroutine call as suspicious;
linters and type checkers can flag un-awaited coroutines.

**Pitfall 3: creating tasks and dropping them.** A task with no
reference can be garbage-collected mid-flight in some Python versions,
which cancels it unpredictably. Fix: keep a strong reference, e.g.
append tasks to a `set` and discard them in a done-callback:
`task.add_done_callback(background_tasks.discard)`.

**Pitfall 4: unhandled exceptions in background tasks.** If a task
raises and nobody ever awaits it or checks `task.exception()`,
the exception is only logged as "exception was never retrieved".
Fix: always await tasks you create, or attach a done-callback that
inspects the result.

**Pitfall 5: sharing mutable state without thinking.** Tasks
interleave only at `await` points, so code between two awaits is
atomic — but anything can change across an `await`. Fix: re-read
shared state after awaiting, or guard critical sections with
`asyncio.Lock`.

## 5. Cancellation patterns

Cancellation in asyncio is delivered as `CancelledError` raised at
the current `await` point. Three patterns cover most needs:

1. **Timeout a single operation:** `await asyncio.wait_for(work(), 10)`.
2. **Cancel on demand:** keep the task handle and call `task.cancel()`,
   then `await task` inside try/except to let cleanup run.
3. **Shield critical cleanup:** `await asyncio.shield(cleanup())`
   protects the cleanup coroutine from an outer cancellation while
   still allowing the outer scope to be cancelled.

Always put resource release (closing sessions, files, connections) in
`finally` blocks or async context managers (`async with`), because
cancellation can arrive at any `await`.

## 6. Testing async code

Use `pytest` with the `anyio` or `pytest-asyncio` plugin and mark
tests with `@pytest.mark.asyncio`. Keep tests deterministic: replace
real network calls with fakes, and avoid `asyncio.sleep` with real
durations — inject a clock or keep sleeps tiny. Test cancellation
explicitly: start a task, cancel it, and assert resources were
released.

## 7. Glossary cheat-sheet

- **Event loop**: the scheduler that runs coroutines cooperatively.
- **`asyncio.run()`**: one-shot entry point; creates and closes the loop.
- **Coroutine**: paused-until-awaited async function call.
- **Task**: coroutine scheduled for independent concurrent execution.
- **`gather`**: concurrent run, results in argument order.
- **`wait`**: split tasks into done/pending sets.
- **`wait_for`**: deadline for one coroutine; cancels on timeout.
- **`to_thread`**: run blocking code without freezing the loop.
- **`shield`**: protect a coroutine from outer cancellation.
