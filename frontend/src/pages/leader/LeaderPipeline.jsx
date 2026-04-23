/**
 * LeaderPipeline.jsx
 * Re-exports the agent Pipeline page for leaders.
 * Leaders access the same pipeline via /leader/pipeline.
 * The pipeline reads user.role from useAuth() and adjusts
 * transfer targets accordingly (leader can send to own agents + other leaders).
 */
export { default } from '../agent/Pipeline';
