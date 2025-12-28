'use client'

import EnhancedReportingView from './EnhancedReportingView'

interface ReportingViewProps {
  userProfile: any
}

export default function ReportingView({ userProfile }: ReportingViewProps) {
  return <EnhancedReportingView userProfile={userProfile} />
}
