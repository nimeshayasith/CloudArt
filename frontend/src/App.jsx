import { Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './auth/ProtectedRoute'
import AdminCourseEditor from './pages/AdminCourseEditor'
import AdminCourses from './pages/AdminCourses'
import AdminDashboard from './pages/AdminDashboard'
import AdminLabEditor from './pages/AdminLabEditor'
import AdminLabs from './pages/AdminLabs'
import AdminQuizEditor from './pages/AdminQuizEditor'
import Attempt from './pages/Attempt'
import CourseDetail from './pages/CourseDetail'
import Courses from './pages/Courses'
import Dashboard from './pages/Dashboard'
import Home from './pages/Home'
import LabDetail from './pages/LabDetail'
import LabWork from './pages/LabWork'
import Labs from './pages/Labs'
import Learn from './pages/Learn'
import Login from './pages/Login'
import Profile from './pages/Profile'
import Quiz from './pages/Quiz'
import Register from './pages/Register'
import VerifyEmail from './pages/VerifyEmail'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify" element={<VerifyEmail />} />
      <Route path="/login" element={<Login />} />
      <Route path="/courses" element={<Courses />} />
      <Route path="/courses/:slug" element={<CourseDetail />} />
      <Route path="/labs" element={<Labs />} />
      <Route path="/labs/:slug" element={<LabDetail />} />
      <Route path="/labs/:slug/work" element={<ProtectedRoute><LabWork /></ProtectedRoute>} />
      <Route path="/learn/:slug" element={<ProtectedRoute><Learn /></ProtectedRoute>} />
      <Route path="/quiz/:quizId" element={<ProtectedRoute><Quiz /></ProtectedRoute>} />
      <Route path="/attempt/:attemptId" element={<ProtectedRoute><Attempt /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/dashboard/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute admin><AdminDashboard /></ProtectedRoute>} />
      <Route path="/admin/courses" element={<ProtectedRoute admin><AdminCourses /></ProtectedRoute>} />
      <Route path="/admin/courses/:id" element={<ProtectedRoute admin><AdminCourseEditor /></ProtectedRoute>} />
      <Route path="/admin/quizzes/:id" element={<ProtectedRoute admin><AdminQuizEditor /></ProtectedRoute>} />
      <Route path="/admin/labs" element={<ProtectedRoute admin><AdminLabs /></ProtectedRoute>} />
      <Route path="/admin/labs/:id" element={<ProtectedRoute admin><AdminLabEditor /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
