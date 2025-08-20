import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const AfterAnswer = ({ nickname }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-blue-600 to-indigo-700 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="text-6xl mb-4">✅</div>
          <CardTitle className="text-2xl">Đã gửi câu trả lời</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-600 mb-4">
            {nickname ? `${nickname}, ` : ''}vui lòng chờ những người chơi khác hoàn tất.
          </p>
          <div className="flex items-center justify-center space-x-2 text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span>Đang chờ mọi người...</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AfterAnswer;
